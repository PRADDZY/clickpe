"""Isolated synthetic benchmark; never writes to the active product catalogue."""

import argparse
import json
import os
import subprocess
import tempfile
import time
import uuid
from contextlib import suppress
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from app import database
from app.api.routes import NextBatchRequest, _validate_rules, next_match_batch
from app.config import get_settings
from app.csv_ingestion import import_upload
from app.migrate import migrate

ROOT = Path(__file__).resolve().parents[1]
WORKER = r"""
const readline=require('readline'),crypto=require('crypto');let evaluate;
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
readline.createInterface({input:process.stdin}).on('line',line=>{
 const item=JSON.parse(line);
 if(item.code){evaluate=new Function('$input',item.code);console.log('{}');return;}
 const start=performance.now();const result=evaluate({first:()=>({json:item.page})})[0].json.results;const ms=performance.now()-start;
 const normalized=result.map(({rule_version,...r})=>r).sort((a,b)=>a.user_id.localeCompare(b.user_id)||a.product_id.localeCompare(b.product_id));
 console.log(JSON.stringify({count:result.length,ms,rss:process.resourceUsage().maxRSS*1024,digest:crypto.createHash('sha256').update(JSON.stringify(canonical(normalized))).digest('hex')}));
});
"""


class Evaluator:
    def __init__(self, code: str):
        self.process = subprocess.Popen(
            ["node", "-e", WORKER],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.exchange({"code": code})

    def exchange(self, message):
        self.process.stdin.write(json.dumps(message, default=str) + "\n")
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError("Benchmark evaluator exited unexpectedly")
        return json.loads(line)

    def close(self):
        with suppress(BrokenPipeError):
            self.process.stdin.close()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()


def benchmark(url: str, applicants: int, products: int) -> dict:
    schema = "benchmark_" + uuid.uuid4().hex
    original_connect = database._connect
    original_mode = get_settings().notification_mode
    workers = []
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(f'CREATE SCHEMA "{schema}"')
    database._connect = lambda: psycopg.connect(
        url,
        options=f"-c search_path={schema},public",
        row_factory=dict_row,
    )
    try:
        migrate()
        get_settings().notification_mode = "preview"
        with database.connection() as conn:
            conn.execute("UPDATE product SET active=FALSE")
            for i in range(products):
                product_id = f"fixture-{i:03}"
                rules = {
                    "version": "1",
                    "employment": {
                        "kind": "required",
                        "status": "Salaried" if i % 2 else "Business",
                    },
                    "age": {"kind": "required", "min": 21, "max": 60},
                    "monthly_income": {
                        "kind": "required",
                        "min": 15000 + i * 1000,
                        "currency": "INR",
                        "location_dependent": False,
                    },
                    "credit_score": {
                        "kind": "preferred" if i % 3 else "required",
                        "min": 650 + i % 50,
                    },
                    "incomplete_eligibility": "review",
                }
                _validate_rules(rules)
                conn.execute(
                    "INSERT INTO product (product_id,lender,product_name,product_url) VALUES (%s,'Synthetic fixture',%s,'https://example.invalid')",
                    (product_id, product_id),
                )
                snapshot = conn.execute(
                    "INSERT INTO policy_snapshot (product_id,source_url,source_digest,model_provider,model_name,extraction_status,rules,source_excerpt) "
                    "VALUES (%s,'https://example.invalid',%s,'fixture','fixture','approved',%s::jsonb,'Synthetic benchmark rules') RETURNING snapshot_id",
                    (product_id, product_id, json.dumps(rules)),
                ).fetchone()
                conn.execute(
                    "UPDATE product SET current_snapshot_id=%s WHERE product_id=%s",
                    (snapshot["snapshot_id"], product_id),
                )
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "synthetic.csv"
            with path.open("w", encoding="utf-8", newline="") as f:
                f.write("user_id,name,email,monthly_income,credit_score,employment_status,age\n")
                for i in range(applicants):
                    employment = "Salaried" if i % 3 else "Business"
                    f.write(
                        f"fixture-{i:06},Synthetic Applicant,fixture@example.invalid,{10000 + i % 100 * 1000},{600 + i % 251},{employment},{18 + i % 53}\n"
                    )
            upload_id = str(uuid.uuid4())
            with database.connection() as conn:
                conn.execute(
                    "INSERT INTO upload (upload_id,object_key,filename,status) VALUES (%s,%s,'synthetic.csv','queued')",
                    (upload_id, upload_id),
                )
            run = import_upload(upload_id, upload_id, path.name, path)
        policies = database.all_rows(
            "SELECT rp.product_id,s.snapshot_id::text,s.rules FROM run_policy rp JOIN policy_snapshot s ON s.snapshot_id=rp.snapshot_id WHERE rp.run_id=%s ORDER BY rp.product_id",
            (run.run_id,),
        )
        workflow = json.loads(
            (ROOT / "n8n/workflows/02-match-applicants.json").read_text(encoding="utf-8")
        )
        staged = Evaluator(
            next(
                n["parameters"]["jsCode"] for n in workflow["nodes"] if n["type"].endswith(".code")
            )
        )
        workers.append(staged)
        baseline = Evaluator((ROOT / "tests/fixtures/rules-v1.js").read_text())
        workers.append(baseline)
        report = {
            "dataset": "synthetic",
            "applicants": applicants,
            "products": products,
            "expected_pairs": applicants * products,
            "evaluated_pairs": 0,
            "sql_prefiltered_pairs": 0,
            "candidate_pairs": 0,
            "pages": 0,
            "sql_fetch_seconds": 0.0,
            "baseline_js_ms": 0.0,
            "staged_js_ms": 0.0,
            "baseline_node_peak_rss_bytes": 0,
            "staged_node_peak_rss_bytes": 0,
            "max_decisions_per_batch": 0,
            "llm_calls_per_pair": 0,
            "parity": True,
            "persisted_results": False,
        }
        cursor = ""
        while True:
            start = time.perf_counter()
            page = next_match_batch(NextBatchRequest(run_id=run.run_id, cursor_user_id=cursor))
            report["sql_fetch_seconds"] += time.perf_counter() - start
            old = baseline.exchange(
                {"page": {**page, "users": [{**u, "products": policies} for u in page["users"]]}}
            )
            new = staged.exchange({"page": page})
            if old["digest"] != new["digest"] or old["count"] != new["count"]:
                raise AssertionError("Staged benchmark differs from previous matcher")
            report["pages"] += 1
            report["evaluated_pairs"] += new["count"]
            report["sql_prefiltered_pairs"] += page["prefiltered_count"]
            report["candidate_pairs"] += page["candidate_count"]
            report["max_decisions_per_batch"] = max(report["max_decisions_per_batch"], new["count"])
            for prefix, value in (("baseline", old), ("staged", new)):
                report[f"{prefix}_js_ms"] += value["ms"]
                report[f"{prefix}_node_peak_rss_bytes"] = max(
                    report[f"{prefix}_node_peak_rss_bytes"], value["rss"]
                )
            if not page["has_more"]:
                break
            cursor = page["last_user_id"]
        assert report["evaluated_pairs"] == report["expected_pairs"]
        return report
    finally:
        for worker in workers:
            worker.close()
        database._connect = original_connect
        get_settings().notification_mode = original_mode
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute(f'DROP SCHEMA "{schema}" CASCADE')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--applicants", type=int, default=10000)
    parser.add_argument("--products", type=int, default=50)
    parser.add_argument("--output", type=Path, default=Path("benchmark.json"))
    args = parser.parse_args()
    url = os.environ.get("TEST_DATABASE_URL")
    if not url or not 1 <= args.applicants <= 100000 or not 1 <= args.products <= 400:
        parser.error("Set TEST_DATABASE_URL to disposable PostgreSQL and use valid bounded sizes")
    report = benchmark(url, args.applicants, args.products)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
