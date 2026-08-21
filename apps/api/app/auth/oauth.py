import base64
import hashlib
import secrets
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException, status

from app.config import Settings
from app.services import normalize_email


@dataclass(frozen=True)
class GoogleIdentity:
    provider_account_id: str
    email: str
    name: str
    avatar_url: str | None


class GoogleOAuthService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @property
    def configured(self) -> bool:
        return bool(self.settings.google_client_id and self.settings.google_client_secret)

    def create_authorization_request(self) -> tuple[str, str, str]:
        state = secrets.token_urlsafe(32)
        code_verifier = secrets.token_urlsafe(64)
        digest = hashlib.sha256(code_verifier.encode()).digest()
        code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
        url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(
            {
                "client_id": self.settings.google_client_id,
                "redirect_uri": str(self.settings.google_redirect_uri),
                "response_type": "code",
                "scope": "openid email profile",
                "state": state,
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
                "prompt": "select_account",
            }
        )
        return url, state, code_verifier

    async def exchange(self, code: str, code_verifier: str) -> GoogleIdentity:
        if not self.configured:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Google OAuth is not configured",
            )
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                token_response = await client.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "code": code,
                        "client_id": self.settings.google_client_id,
                        "client_secret": self.settings.google_client_secret,
                        "redirect_uri": str(self.settings.google_redirect_uri),
                        "grant_type": "authorization_code",
                        "code_verifier": code_verifier,
                    },
                )
                token_response.raise_for_status()
                access_token = token_response.json()["access_token"]
                profile_response = await client.get(
                    "https://openidconnect.googleapis.com/v1/userinfo",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                profile_response.raise_for_status()
                profile = profile_response.json()
        except (httpx.HTTPError, KeyError, ValueError) as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Google sign-in failed",
            ) from error

        provider_account_id = profile.get("sub")
        email = profile.get("email")
        if not provider_account_id or not email or profile.get("email_verified") is not True:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Google account has no verified email",
            )
        normalized_email = normalize_email(email)
        return GoogleIdentity(
            provider_account_id=provider_account_id,
            email=normalized_email,
            name=(profile.get("name") or normalized_email.split("@", maxsplit=1)[0])[:120],
            avatar_url=profile.get("picture"),
        )
