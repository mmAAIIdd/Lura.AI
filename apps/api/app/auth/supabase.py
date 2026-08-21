"""Supabase identity verification.

Supabase Auth owns email registration, confirmation and passwords. This module
turns a Supabase access token into the identity behind it, so the API can open
one of its own sessions for that person.

Verification is delegated to Supabase's `/auth/v1/user` endpoint rather than
done locally: it is the authority on whether a token is genuine, unexpired and
not revoked, and it removes any need to hold signing keys in this service.
"""

from typing import Any

import httpx

from app.config import Settings


class SupabaseIdentityError(Exception):
    """The access token was rejected, or Supabase could not be reached."""


class SupabaseIdentityService:
    def __init__(self, settings: Settings) -> None:
        self._base_url = str(settings.supabase_url).rstrip("/") if settings.supabase_url else None
        self._api_key = settings.supabase_publishable_key

    @property
    def configured(self) -> bool:
        return bool(self._base_url and self._api_key)

    async def get_user(self, access_token: str) -> dict[str, Any]:
        if not self.configured:
            raise SupabaseIdentityError("Supabase identity is not configured")

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self._base_url}/auth/v1/user",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "apikey": self._api_key or "",
                    },
                )
        except httpx.HTTPError as error:
            raise SupabaseIdentityError("Supabase is unreachable") from error

        if response.status_code != 200:
            raise SupabaseIdentityError("Supabase rejected the access token")

        try:
            profile = response.json()
        except ValueError as error:
            raise SupabaseIdentityError("Supabase returned an unreadable response") from error

        if not isinstance(profile, dict) or not profile.get("id"):
            raise SupabaseIdentityError("Supabase returned no user identity")
        return profile
