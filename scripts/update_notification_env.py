"""Synchronize non-secret notification configuration during host deployment."""

import json
from pathlib import Path


def main() -> None:
    root = Path("/opt/clickpe")
    config_path = root / ".notification-config.json"
    settings = json.loads(config_path.read_text())
    allowed = {
        "SES_ROLE_ARN",
        "SES_EXTERNAL_ID_SECRET_ARN",
        "NOTIFICATION_MODE",
        "SES_SENDER",
        "TEST_RECIPIENTS",
    }
    if set(settings) != allowed or settings["NOTIFICATION_MODE"] not in {"test", "preview"}:
        raise ValueError("Invalid notification deployment configuration")
    if any(
        not isinstance(value, str) or "\n" in value or "\r" in value for value in settings.values()
    ):
        raise ValueError("Invalid notification deployment value")
    path = root / ".env"
    lines = [
        line for line in path.read_text().splitlines() if line.partition("=")[0] not in allowed
    ]
    path.write_text(
        "\n".join([*lines, *(f"{key}={value}" for key, value in settings.items())]) + "\n"
    )
    path.chmod(0o600)
    config_path.unlink()


if __name__ == "__main__":
    main()
