from __future__ import annotations

import uvicorn

from api.config import settings


def main() -> None:
    uvicorn.run(
        "api.app:create_app",
        factory=True,
        host=settings.host,
        port=settings.port,
        log_config=None,
    )


if __name__ == "__main__":
    main()
