"""Deployment configuration contracts that prevent accidental host replacement."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_host_rollout_waits_for_initial_bootstrap_before_backup():
    script = (ROOT / "scripts/Update-AwsHost.ps1").read_text()
    assert script.index("cloud-init status --wait") < script.index("tar -czf")
    assert script.index("test -f docker-compose.yml && test -f .env") < script.index("tar -czf")


def test_existing_host_image_is_preserved_unless_explicitly_overridden():
    template = (ROOT / "serverless.yml").read_text()
    script = (ROOT / "scripts/Deploy-Aws.ps1").read_text()
    assert "ImageId: ${env:N8N_AMI_ID, self:custom.defaultHostImage}" in template
    assert "-not $env:N8N_AMI_ID" in script
    assert script.index("Reservations[0].Instances[0].ImageId") < script.index("@('deploy'")
    assert "$env:N8N_AMI_ID = $hostImage" in script
    assert "Set-Item Env:\\N8N_AMI_ID $previousHostImage" in script
