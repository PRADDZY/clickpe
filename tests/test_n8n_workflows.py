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
    assert gate[0][0]["node"] == ses["name"]
    assert gate[1][0]["node"] == "Preview complete"
