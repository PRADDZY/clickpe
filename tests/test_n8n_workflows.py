import json
from pathlib import Path

WORKFLOW_DIR = Path(__file__).resolve().parents[1] / "n8n" / "workflows"


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
    assert "limit 201" in query and "seq<=200" in query
    assert "monthly_income" in query and "credit_score" in query
    assert "u.name" not in query and "u.email" not in query
    assert "user.products" in matcher["parameters"]["jsCode"]
    assert "maxTries" not in postgres["parameters"]


def test_notification_workflow_records_preview_only_without_returning_addresses():
    workflow = json.loads(
        (WORKFLOW_DIR / "03-prepare-notification-preview.json").read_text(encoding="utf-8")
    )
    query = next(
        node["parameters"]["query"]
        for node in workflow["nodes"]
        if node["type"] == "n8n-nodes-base.postgres"
    ).lower()
    summary = next(
        node["parameters"]["jsCode"]
        for node in workflow["nodes"]
        if node["type"] == "n8n-nodes-base.code"
    )
    assert "'preview'" in query and "'previewed'" in query
    assert "lower(u.email)" in query
    assert "select u.email" not in query
    assert "delivery_enabled:false" in summary
    assert not any(
        "ses" in node["type"].lower() or "sendemail" in node["name"].lower()
        for node in workflow["nodes"]
    )
