from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class RequestSizeLimitMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        max_bytes: int,
        upload_max_bytes: int | None = None,
        upload_path_suffix: str = "/documents",
    ) -> None:
        self.app = app
        self.max_bytes = max_bytes
        # Document ingestion carries whole files, so it gets its own ceiling instead of
        # loosening the tight default that protects every other endpoint.
        self.upload_max_bytes = upload_max_bytes or max_bytes
        self.upload_path_suffix = upload_path_suffix

    def limit_for(self, scope: Scope) -> int:
        path = scope.get("path", "")
        if scope.get("method") == "POST" and path.endswith(self.upload_path_suffix):
            return self.upload_max_bytes
        return self.max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        max_bytes = self.limit_for(scope)
        content_length = Headers(scope=scope).get("content-length")
        if content_length:
            try:
                if int(content_length) > max_bytes:
                    await self._reject(scope, receive, send)
                    return
            except ValueError:
                await self._reject(scope, receive, send)
                return

        bytes_received = 0
        rejected = False

        async def limited_receive() -> Message:
            nonlocal bytes_received, rejected
            message = await receive()
            if message["type"] == "http.request":
                bytes_received += len(message.get("body", b""))
                if bytes_received > max_bytes:
                    rejected = True
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message: Message) -> None:
            if not rejected:
                await send(message)

        await self.app(scope, limited_receive, guarded_send)
        if rejected:
            await self._reject(scope, receive, send)

    @staticmethod
    async def _reject(scope: Scope, receive: Receive, send: Send) -> None:
        response = JSONResponse({"detail": "Request body is too large"}, status_code=413)
        await response(scope, receive, send)


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp, production: bool) -> None:
        self.app = app
        self.production = production

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.extend(
                    [
                        (b"x-content-type-options", b"nosniff"),
                        (b"referrer-policy", b"no-referrer"),
                        (b"cache-control", b"no-store"),
                    ]
                )
                if self.production:
                    headers.append(
                        (b"strict-transport-security", b"max-age=31536000; includeSubDomains")
                    )
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)
