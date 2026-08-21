from dataclasses import dataclass

import httpx
from fastapi import HTTPException, Request, status

from app.config import Settings
from app.services import get_client_ip


@dataclass
class CaptchaVerifier:
    settings: Settings

    async def verify(self, token: str | None, request: Request, action: str) -> None:
        if self.settings.captcha_provider == "disabled":
            return
        if not token:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="CAPTCHA verification is required",
                headers={"X-Captcha-Required": "true"},
            )

        payload = {
            "secret": self.settings.turnstile_secret_key,
            "response": token,
        }
        client_ip = get_client_ip(request)
        if client_ip:
            payload["remoteip"] = client_ip

        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response = await client.post(str(self.settings.turnstile_verify_url), data=payload)
                response.raise_for_status()
                result = response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="CAPTCHA verification is temporarily unavailable",
            ) from error

        expected_hostname = self.settings.frontend_url.host
        if (
            not result.get("success")
            or result.get("action") not in (None, action)
            or (expected_hostname and result.get("hostname") not in (None, expected_hostname))
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="CAPTCHA verification failed",
                headers={"X-Captcha-Required": "true"},
            )
