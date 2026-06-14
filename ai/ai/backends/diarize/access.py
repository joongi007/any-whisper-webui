"""Real gated-access check for the pyannote models.

`bool(huggingface_token)` is a lie: a valid token whose account hasn't
accepted the model terms still gets a 403. This probes actual access so the
Settings card stops saying "Ready" when diarization will in fact fail.

Non-blocking by design: `diarize_access()` returns the cached verdict
immediately (the system-info reply has a tight 2s budget and must not wait on
an HF round-trip), and kicks off a background probe when the verdict is still
unknown. Within one UI poll (~30s) the cache reflects reality.

Caching: a confirmed `True` is sticky (terms acceptance is permanent). An
unconfirmed/`False` verdict is re-probed on the next call so the card flips to
Ready shortly after the user accepts the terms — no ai restart."""

from __future__ import annotations

import asyncio

import structlog

from ai.config import settings

log = structlog.get_logger()

# All must be accessible. pyannote.audio 4.x loads speaker-diarization-3.1 but
# pulls the PLDA from speaker-diarization-community-1 at pipeline build time, so
# that third repo needs terms accepted too (not obvious from the 3.1 model card).
_REPOS = (
    "pyannote/speaker-diarization-3.1",
    "pyannote/segmentation-3.0",
    "pyannote/speaker-diarization-community-1",
)

_confirmed = False        # sticky True once access is verified
_probing = False          # a background probe is in flight
# Why the last probe failed, so the UI can give a precise instruction instead
# of a generic "needs token". One of: None | "no_token" | "terms" |
# "permission" | "network".
_reason: str | None = None


def diarize_reason() -> str | None:
    """The classified failure reason from the last probe (None when access is
    confirmed). Lets the Settings card say *which* of the two HF gotchas is
    blocking: model terms not accepted, vs. token lacking gated-repo scope."""
    return None if _confirmed else _reason


def _probe() -> bool:
    """Blocking HF auth check for every required repo. Returns True only if
    all are accessible with the configured token. Sets `_reason` on failure."""
    global _reason
    token = settings.huggingface_token
    if not token:
        _reason = "no_token"
        return False
    try:
        from huggingface_hub import auth_check
        from huggingface_hub.utils import GatedRepoError, RepositoryNotFoundError
    except Exception:  # noqa: BLE001 — very old hub without auth_check
        # Can't verify → fall back to "token present" so we don't block a
        # working setup behind a library-version quirk.
        _reason = None
        return True
    for repo in _REPOS:
        try:
            auth_check(repo, token=token)
        except GatedRepoError:
            # Token is fine, the account just hasn't accepted the model terms.
            log.info("diarize_access_gated", repo=repo)
            _reason = "terms"
            return False
        except RepositoryNotFoundError:
            log.warning("diarize_repo_not_found", repo=repo)
            _reason = "network"
            return False
        except Exception as exc:  # noqa: BLE001 — usually a 403 permission wall
            msg = str(exc).lower()
            # A 403 mentioning gated / fine-grained = the token lacks the
            # "access public gated repos" scope (vs. terms not accepted).
            if "403" in msg or "gated" in msg or "fine-grained" in msg or "permission" in msg:
                _reason = "permission"
            else:
                _reason = "network"
            log.warning("diarize_access_check_failed", repo=repo, reason=_reason, error=str(exc)[:200])
            return False
    _reason = None
    return True


async def _probe_bg() -> None:
    global _confirmed, _probing
    try:
        ok = await asyncio.to_thread(_probe)
        if ok:
            _confirmed = True
    finally:
        _probing = False


async def diarize_access() -> bool:
    """Cached, non-blocking. Returns the last known verdict instantly and
    refreshes it in the background when still unconfirmed."""
    global _probing
    if _confirmed:
        return True
    if settings.huggingface_token and not _probing:
        _probing = True
        asyncio.create_task(_probe_bg())
    return _confirmed
