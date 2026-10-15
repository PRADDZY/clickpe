"""Prepare n8n imports inside the host. Secrets never leave the runtime directory."""

import json
import os
from pathlib import Path
from urllib.parse import unquote, urlparse

from app.config import get_settings
from app.database import _secret

settings = get_settings()
root = Path("/runtime")
root.mkdir(exist_ok=True)
if settings.database_secret_arn:
    secret = _secret(settings.database_secret_arn)
    postgres = {
        "host": settings.database_host,
        "database": secret.get("dbname", "loan_engine"),
        "user": secret["username"],
        "password": secret["password"],
        "ssl": "require",
    }
else:
    url = urlparse(settings.database_url)
    postgres = {
        "host": url.hostname,
        "database": url.path.lstrip("/"),
        "user": unquote(url.username or ""),
        "password": unquote(url.password or ""),
        "ssl": "disable",
    }
postgres.update(port=5432, allowUnauthorizedCerts=False, maxConnections=5)
token = (
    _secret(settings.internal_token_secret_arn)
    if settings.internal_token_secret_arn
    else settings.internal_api_token
)
credentials = [
    {"id": "clickpe-postgres", "name": "ClickPe database", "type": "postgres", "data": postgres},
    {
        "id": "clickpe-internal",
        "name": "ClickPe internal API",
        "type": "httpHeaderAuth",
        "data": {"name": "X-Internal-Token", "value": token},
    },
]
existing_path = root / "existing-workflows.json"
existing = json.loads(existing_path.read_text()) if existing_path.exists() else []
existing_nodes = {n["id"]: n for w in existing for n in w.get("nodes", [])}
publish = []
workflows = []
for path in sorted(Path("/seed/workflows").glob("*.json")):
    workflow = json.loads(path.read_text())
    for node in workflow["nodes"]:
        if "credentials" not in node and existing_nodes.get(node["id"], {}).get("credentials"):
            node["credentials"] = existing_nodes[node["id"]]["credentials"]
        url = node["parameters"].get("url", "")
        for domain, variable, cid, header, prefix in [
            (
                "openrouter.ai",
                "OPENROUTER_API_KEY",
                "clickpe-openrouter",
                "Authorization",
                "Bearer ",
            ),
            (
                "generativelanguage.googleapis.com",
                "GEMINI_API_KEY",
                "clickpe-gemini",
                "x-goog-api-key",
                "",
            ),
        ]:
            if domain in url and os.environ.get(variable):
                credentials.append(
                    {
                        "id": cid,
                        "name": cid,
                        "type": "httpHeaderAuth",
                        "data": {"name": header, "value": prefix + os.environ[variable]},
                    }
                )
                node["credentials"] = {"httpHeaderAuth": {"id": cid, "name": cid}}
        # No SES credentials are fabricated. Preview remains fully operational.
        if node["type"] == "n8n-nodes-base.awsSes":
            old = existing_nodes.get(node["id"], {}).get("credentials")
            if old:
                node["credentials"] = old
            elif settings.notification_mode != "test":
                node["disabled"] = True
    discovery = path.name.startswith("01")
    if not discovery or all(
        n.get("credentials")
        for n in workflow["nodes"]
        if n["type"] == "n8n-nodes-base.httpRequest"
        and any(
            host in n["parameters"].get("url", "") for host in ["openrouter.ai", "googleapis.com"]
        )
    ):
        publish.append(workflow["id"])
    workflows.append(workflow)
for name, data in [("credentials.json", credentials), ("workflows.json", workflows)]:
    path = root / name
    path.write_text(json.dumps(data))
    path.chmod(0o600)
(root / "publish.txt").write_text("\n".join(publish) + "\n")
print(f"Prepared {len(workflows)} workflows; {len(publish)} ready to publish.")
