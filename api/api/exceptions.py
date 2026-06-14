from __future__ import annotations

from fastapi import HTTPException


class DomainError(HTTPException):
    code = "internal_error"
    default_status = 500

    def __init__(self, message: str, *, status_code: int | None = None, fields: dict | None = None) -> None:
        super().__init__(
            status_code=status_code or self.default_status,
            detail={"code": self.code, "message": message, "fields": fields or {}},
        )


class ValidationFailed(DomainError):
    code = "validation_error"
    default_status = 422


class FileNotFound(DomainError):
    code = "file_not_found"
    default_status = 404


class JobNotFound(DomainError):
    code = "job_not_found"
    default_status = 404


class BackendUnavailable(DomainError):
    code = "backend_unavailable"
    default_status = 503
