import json
import subprocess
from pathlib import Path

WORKFLOW_DIR = Path(__file__).resolve().parents[1] / "n8n" / "workflows"


def test_discovery_uses_free_structured_model_and_records_requested_model():
    workflow = json.loads(
        (WORKFLOW_DIR / "01-discover-official-policies.json").read_text(encoding="utf-8")
    )
    codes = {
        node["name"]: node["parameters"].get("jsCode", "") for node in workflow["nodes"]
    }
    script = """
const {codes}=JSON.parse(require('fs').readFileSync(0,'utf8'));
const source={product_id:'fixture',lender:'Fixture lender',product_name:'Fixture loan',
 product_url:'https://example.com',source_excerpt:'Official fixture terms for extraction.'};
const build=new Function('$',codes['Build strict extraction request · Code']);
const base=build(()=>({item:{json:source}})).json;
const request=JSON.parse(JSON.stringify(base.request));
base.request.model='fixture-selected-model';
const parsed={employment:{kind:'unknown'},age:{kind:'unknown'},
 monthly_income:{kind:'unknown'},credit_score:{kind:'unknown'}};
const validate=new Function('$json','$',codes['Validate primary extraction · Code']);
const result=validate({choices:[{message:{content:JSON.stringify(parsed)}}]},
 ()=>({item:{json:base}})).json;
console.log(JSON.stringify({request,model_name:result.model_name}));
"""
    result = subprocess.run(
        ["node", "-e", script],
        input=json.dumps({"codes": codes}),
        text=True,
        capture_output=True,
        check=True,
    )
    data = json.loads(result.stdout)
    request = data["request"]
    assert request["model"] == "nvidia/nemotron-3-super-120b-a12b:free"
    assert request["response_format"]["json_schema"]["strict"] is True
    assert request["provider"]["require_parameters"] is True
    assert request["max_tokens"] >= 4000
    assert request["reasoning"] == {"effort": "low", "exclude": True}
    assert data["model_name"] == "fixture-selected-model"


def test_discovery_provider_retries_are_bounded():
    workflow = json.loads(
        (WORKFLOW_DIR / "01-discover-official-policies.json").read_text(encoding="utf-8")
    )
    providers = [node for node in workflow["nodes"] if node["name"].startswith("Extract with")]
    assert len(providers) == 2
    for node in providers:
        assert node["retryOnFail"] is True
        assert 2 <= node["maxTries"] <= 3
        assert node["waitBetweenTries"] >= 1000
        assert node["parameters"]["options"]["timeout"] <= 60_000


def test_workflow_exports_are_valid_and_have_no_embedded_credentials():
    workflows = list(WORKFLOW_DIR.glob("*.json"))
    assert len(workflows) == 3
    for path in workflows:
        workflow = json.loads(path.read_text(encoding="utf-8"))
        assert workflow["active"] is False
        for node in workflow["nodes"]:
            for credential in node.get("credentials", {}).values():
                assert "password" not in credential
                assert "api_key" not in credential


def test_matcher_fetches_bounded_batches_without_applicant_names_or_emails():
    workflow = json.loads((WORKFLOW_DIR / "02-match-applicants.json").read_text(encoding="utf-8"))
    postgres = next(node for node in workflow["nodes"] if node["type"] == "n8n-nodes-base.postgres")
    matcher = next(node for node in workflow["nodes"] if node["type"] == "n8n-nodes-base.code")
    query = postgres["parameters"]["query"].lower()
    assert "400/greatest(count(*)" in query
    assert "run_policy" in query
    from app.matching import PAGE_QUERY

    assert query == PAGE_QUERY.replace("%(run_id)s", "$1").replace("%(cursor)s", "$2").lower()
    assert "monthly_income" in query and "credit_score" in query
    assert "u.name" not in query and "u.email" not in query
    assert "user.products" in matcher["parameters"]["jsCode"]
    assert "maxTries" not in postgres["parameters"]


def test_notification_workflow_gates_ses_and_does_not_retry_sends():
    workflow = json.loads(
        (WORKFLOW_DIR / "03-prepare-notification-preview.json").read_text(encoding="utf-8")
    )
    nodes = workflow["nodes"]
    ses = next(n for n in nodes if n["type"] == "n8n-nodes-base.awsSes")
    assert ses["retryOnFail"] is False
    assert ses["parameters"]["toAddresses"] == ["={{ $json.recipient }}"]
    assert any(n["type"] == "n8n-nodes-base.if" for n in nodes)
    gate = workflow["connections"]["Controlled test delivery enabled?"]["main"]
    assert gate[0][0]["node"] == "Attach personalized message"
    assert (
        workflow["connections"]["Attach personalized message"]["main"][0][0]["node"] == ses["name"]
    )
    assert gate[1][0]["node"] == "Deliver applicants sequentially"
    assert ses["parameters"]["authentication"] == "assumeRole"
    assert any(n["type"] == "n8n-nodes-base.scheduleTrigger" for n in nodes)
    assert any(n["name"] == "Reserve delivery before SES" for n in nodes)
    assert next(n for n in nodes if n["name"] == "Record SES receipt")["retryOnFail"] is True


def test_ses_generic_error_classification_preserves_ambiguous_sends():
    workflow = json.loads(
        (WORKFLOW_DIR / "03-prepare-notification-preview.json").read_text(encoding="utf-8")
    )
    code = next(
        n["parameters"]["jsCode"] for n in workflow["nodes"] if n["name"] == "Classify send failure"
    )
    cases = {
        "Bad request - please check your parameters": ("rejected", "rejected"),
        "Forbidden - perhaps check your credentials?": ("rejected", "rejected"),
        "The service is receiving too many requests from you": ("rejected", "throttled"),
        "socket hang up": ("uncertain", "transport_error"),
    }
    result = subprocess.run(
        [
            "node",
            "-e",
            "const fs=require('fs');const {code,cases}=JSON.parse(fs.readFileSync(0,'utf8'));const f=new Function('$json','$',code);console.log(JSON.stringify(Object.keys(cases).map(error=>f({error},()=>({item:{json:{delivery_id:'fixture',claim_token:'fixture'}}})).json)));",
        ],
        input=json.dumps({"code": code, "cases": cases}),
        text=True,
        capture_output=True,
        check=True,
    )
    for row, expected in zip(json.loads(result.stdout), cases.values(), strict=True):
        assert (row["outcome"], row["error_code"]) == expected
