from uuid import uuid4


class DomainError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message

    def body(self, request_id=None):
        return {
            "code": self.code,
            "message": self.message,
            "details": [],
            "request_id": str(request_id or uuid4()),
        }
