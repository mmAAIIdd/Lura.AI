from typing import Any

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.auth import captcha as captcha_module
from app.auth.captcha import CaptchaVerifier
from app.config import Settings


class FakeResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return self.payload


class FakeHttpClient:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload

    async def __aenter__(self) -> "FakeHttpClient":
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def post(self, _url: str, data: dict[str, Any]) -> FakeResponse:
        assert data["secret"] == "turnstile-secret"
        assert data["response"] == "browser-token"
        return FakeResponse(self.payload)


def make_request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/auth/register",
            "headers": [],
            "client": ("127.0.0.1", 12345),
        }
    )


def make_settings() -> Settings:
    return Settings(
        environment="test",
        secret_key="captcha-test-secret-with-thirty-two-characters",
        captcha_provider="turnstile",
        turnstile_site_key="turnstile-site",
        turnstile_secret_key="turnstile-secret",
    )


@pytest.mark.asyncio
async def test_captcha_requires_token() -> None:
    verifier = CaptchaVerifier(make_settings())
    with pytest.raises(HTTPException) as error:
        await verifier.verify(None, make_request(), "register")
    assert error.value.status_code == 403
    assert error.value.headers == {"X-Captcha-Required": "true"}


@pytest.mark.asyncio
async def test_captcha_validates_provider_response(monkeypatch: pytest.MonkeyPatch) -> None:
    verifier = CaptchaVerifier(make_settings())
    monkeypatch.setattr(
        captcha_module.httpx,
        "AsyncClient",
        lambda **_kwargs: FakeHttpClient(
            {
                "success": True,
                "action": "register",
                "hostname": "localhost",
            }
        ),
    )
    await verifier.verify("browser-token", make_request(), "register")


@pytest.mark.asyncio
async def test_captcha_rejects_wrong_action(monkeypatch: pytest.MonkeyPatch) -> None:
    verifier = CaptchaVerifier(make_settings())
    monkeypatch.setattr(
        captcha_module.httpx,
        "AsyncClient",
        lambda **_kwargs: FakeHttpClient(
            {
                "success": True,
                "action": "forgot_password",
                "hostname": "localhost",
            }
        ),
    )
    with pytest.raises(HTTPException) as error:
        await verifier.verify("browser-token", make_request(), "register")
    assert error.value.status_code == 403
