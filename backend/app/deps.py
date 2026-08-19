"""Request dependencies.

`current_user_id` now lives in auth.py, which verifies a real OIDC token when
AUTH_MODE=jwt. It is re-exported here so every existing
`from ..deps import current_user_id` keeps working unchanged.
"""

from .auth import current_user_id  # noqa: F401

__all__ = ["current_user_id"]
