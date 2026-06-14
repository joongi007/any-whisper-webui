from __future__ import annotations

import ulid


def new_id() -> str:
    return ulid.new().str
