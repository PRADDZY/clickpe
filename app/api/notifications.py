"""Notification preparation. Delivery happens only through n8n's SES node."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.routes import notification_preview, require_internal
from app.config import get_settings
from app.database import connection

router = APIRouter(prefix="/internal/v1", dependencies=[Depends(require_internal)])


class DeliveryReceipt(BaseModel):
    delivery_id: str
    message_id: str = Field(min_length=1, max_length=200)


@router.post("/prepare-notifications/{run_id}")
def prepare_notifications(run_id: str) -> dict[str, Any]:
    summary = notification_preview(run_id, "workflow")
    settings = get_settings()
    recipients = settings.test_recipient_list
    # Exactly one controlled recipient and one sample applicant per run. Neither
    # the CSV's addresses nor a caller-provided address can become recipients.
    if settings.notification_mode != "test" or len(recipients) != 1 or not settings.ses_sender:
        return {**summary, "delivery_enabled": False}
    recipient = next(iter(recipients))
    if "@" not in recipient or any(c in recipient + settings.ses_sender for c in "\r\n,;"):
        raise HTTPException(status_code=503, detail="Invalid test email configuration")
    with connection() as conn, conn.cursor() as cur:
        applicant = cur.execute(
            "SELECT u.user_id,u.name FROM batch_user u WHERE u.run_id=%s AND EXISTS "
            "(SELECT 1 FROM eligibility_result e WHERE e.run_id=u.run_id AND e.user_id=u.user_id AND e.decision='eligible') "
            "ORDER BY u.user_id LIMIT 1",
            (run_id,),
        ).fetchone()
        if not applicant:
            return {
                **summary,
                "delivery_enabled": False,
                "note": "No eligible applicant to demonstrate.",
            }
        products = cur.execute(
            "SELECT p.lender,p.product_name,s.source_url FROM eligibility_result e "
            "JOIN product p ON p.product_id=e.product_id JOIN policy_snapshot s ON s.snapshot_id=e.snapshot_id "
            "WHERE e.run_id=%s AND e.user_id=%s AND e.decision='eligible' ORDER BY p.product_id",
            (run_id, applicant["user_id"]),
        ).fetchall()
        claim = cur.execute(
            "INSERT INTO test_delivery (run_id,recipient,status) VALUES (%s,%s,'claimed') "
            "ON CONFLICT (run_id) DO NOTHING RETURNING delivery_id::text",
            (run_id, recipient),
        ).fetchone()
        if not claim:
            return {
                **summary,
                "delivery_enabled": False,
                "note": "Delivery already claimed; inspect its receipt before any manual resend.",
            }
    body = f"Hello {applicant['name']},\n\nYour profile meets the confirmed rules for:\n"
    body += "\n".join(
        f"- {p['lender']}: {p['product_name']}\n  {p['source_url']}" for p in products
    )
    body += "\n\nThis is an eligibility screening demonstration, not loan approval. The lender makes the final decision.\n"
    body += f"\nTest only: redirected to the configured inbox. Applicant reference: {applicant['user_id']}. Run: {run_id}."
    return {
        **summary,
        "delivery_enabled": True,
        "delivery_id": claim["delivery_id"],
        "recipient": recipient,
        "sender": settings.ses_sender,
        "subject": "ClickPe demo: your matched loan products",
        "body": body,
    }


@router.post("/notification-receipt")
def record_receipt(body: DeliveryReceipt) -> dict[str, str]:
    with connection() as conn, conn.cursor() as cur:
        row = cur.execute(
            "UPDATE test_delivery SET status='sent',provider_message_id=%s,sent_at=COALESCE(sent_at,now()) "
            "WHERE delivery_id=%s AND (provider_message_id IS NULL OR provider_message_id=%s) RETURNING delivery_id",
            (body.message_id, body.delivery_id, body.message_id),
        ).fetchone()
        if not row:
            raise HTTPException(
                status_code=409, detail="Delivery claim not found or receipt conflicts"
            )
    return {"status": "sent"}
