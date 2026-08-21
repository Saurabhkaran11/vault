"""File storage — presigned S3 uploads and downloads.

Until now uploaded bytes never left the browser: only `file_meta`
{name, type, size} was mirrored, so a document restored on a new device
knew its name and could not be opened. This closes that.

Bytes never pass through the API. The browser asks for a presigned URL and
talks to S3 directly, which keeps large uploads off the app servers, avoids
the 5 MB request cap, and means a slow upload cannot occupy a worker. The
API's job is only to decide *whether* you may read or write a given key.

Keys are `u/{user_id}/{item_client_id}/{filename}`. The user id is the first
path segment so a bucket policy or a prefix listing can be scoped per
account, and so an accidental key collision between two users is impossible
by construction rather than by uniqueness of a random id.

Storage is optional: with no bucket configured every entry point reports
that cleanly and the app keeps working exactly as it does today, with file
bodies staying local.
"""

import io
import logging
import re
from dataclasses import dataclass

from .config import settings

log = logging.getLogger("vault.storage")

# Conservative: what S3 accepts is broader, but anything outside this set is
# more likely a path-traversal attempt or an encoding bug than a real name.
_SAFE_SEGMENT = re.compile(r"[^A-Za-z0-9._-]")

# Bytes that are safe to hand back inline. Everything else downloads as an
# attachment, so a malicious upload cannot execute in the vault's origin.
INLINE_TYPES = {
    "application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp",
    "image/svg+xml", "text/plain",
}


class StorageNotConfigured(RuntimeError):
    pass


def storage_enabled() -> bool:
    return bool(settings.s3_bucket)


@dataclass
class PresignedUpload:
    url: str
    fields: dict
    key: str
    max_bytes: int


def _client():
    if not storage_enabled():
        raise StorageNotConfigured(
            "File storage is not configured — set S3_BUCKET (and credentials) to enable uploads."
        )
    import boto3

    return boto3.client(
        "s3",
        region_name=settings.s3_region,
        endpoint_url=settings.s3_endpoint_url or None,
        aws_access_key_id=settings.aws_access_key_id or None,
        aws_secret_access_key=settings.aws_secret_access_key or None,
    )


def safe_key(user_id: str, client_id: str, filename: str) -> str:
    """Build the object key, refusing anything that could escape the prefix.

    Sanitising rather than trusting the client matters here: `filename`
    arrives from the browser, and a name like `../../other-user/secret.pdf`
    would otherwise read across accounts.
    """
    name = _SAFE_SEGMENT.sub("_", (filename or "file").strip())[-120:] or "file"
    uid = _SAFE_SEGMENT.sub("_", user_id)
    cid = _SAFE_SEGMENT.sub("_", str(client_id))
    return f"u/{uid}/{cid}/{name}"


def owns_key(user_id: str, key: str) -> bool:
    """Every read and delete goes through this. The prefix is the ACL."""
    return key.startswith(f"u/{_SAFE_SEGMENT.sub('_', user_id)}/")


def presign_upload(user_id: str, client_id: str, filename: str, content_type: str) -> PresignedUpload:
    """A POST policy, not a PUT URL: the policy can bind the content length,
    so a client cannot use a signed URL to upload something far larger than
    it declared."""
    key = safe_key(user_id, client_id, filename)
    max_bytes = settings.s3_max_upload_bytes
    post = _client().generate_presigned_post(
        Bucket=settings.s3_bucket,
        Key=key,
        Fields={"Content-Type": content_type or "application/octet-stream"},
        Conditions=[
            {"Content-Type": content_type or "application/octet-stream"},
            ["content-length-range", 1, max_bytes],
        ],
        ExpiresIn=settings.s3_url_ttl_seconds,
    )
    return PresignedUpload(url=post["url"], fields=post["fields"], key=key, max_bytes=max_bytes)


def presign_download(key: str, filename: str | None = None, content_type: str | None = None) -> str:
    disposition = "inline" if content_type in INLINE_TYPES else "attachment"
    safe_name = _SAFE_SEGMENT.sub("_", filename or key.rsplit("/", 1)[-1])
    return _client().generate_presigned_url(
        "get_object",
        Params={
            "Bucket": settings.s3_bucket,
            "Key": key,
            "ResponseContentDisposition": f'{disposition}; filename="{safe_name}"',
        },
        ExpiresIn=settings.s3_url_ttl_seconds,
    )


def delete_object(key: str) -> None:
    try:
        _client().delete_object(Bucket=settings.s3_bucket, Key=key)
    except Exception as exc:            # noqa: BLE001 — deletion is best-effort
        # A file that outlives its item wastes storage; a failed request that
        # breaks the user's delete is worse. Log and move on.
        log.warning(f"Could not delete {key}: {type(exc).__name__}: {exc}")


def get_object_bytes(key: str) -> bytes:
    """Download an object for server-side processing (text extraction).

    The only place the API handles file bytes at all. Uploads and downloads
    stay presigned and go browser↔bucket directly; this exists because
    extracting text requires actually reading the file, and doing that in the
    browser would mean shipping a PDF parser to every visitor.
    """
    buf = io.BytesIO()
    _client().download_fileobj(settings.s3_bucket, key, buf)
    return buf.getvalue()
