import asyncio
import logging
from dataclasses import dataclass

import httpx

from app.config import Settings
from app.models import AIModel, Project

logger = logging.getLogger(__name__)

# Google returns these while a model is briefly oversubscribed; the same request usually
# succeeds moments later, so it is retried instead of surfaced to the user.
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


class AIProviderError(Exception):
    """Safe error that can be returned to an authenticated caller."""

    def __init__(self, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


@dataclass(frozen=True)
class RuntimeMessage:
    role: str
    content: str


def build_system_instruction(project: Project, retrieved_context: str | None = None) -> str:
    parts = [
        "You are an AI system running inside Lura.",
        f"Project: {project.name}",
    ]
    if project.system_prompt:
        parts.append(project.system_prompt)
    if project.skills:
        parts.append("Enabled skills:")
        parts.extend(f"- {link.skill.name}: {link.skill.instruction}" for link in project.skills)
    if project.tools:
        tool_names = ", ".join(link.tool.name for link in project.tools)
        parts.append(
            f"Configured tools: {tool_names}. Do not claim to use a tool unless its result is provided to you."
        )
    if retrieved_context:
        parts.append(
            "Retrieved workspace context. These excerpts come from documents the team uploaded to "
            "this project. Ground your answer in them and cite the source title when you use one. "
            "If they do not cover the question, say so instead of inventing facts.\n\n"
            f"{retrieved_context}"
        )
    return "\n\n".join(parts)


class AIProviderRuntime:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def generate(
        self,
        model: AIModel,
        project: Project,
        messages: list[RuntimeMessage],
        retrieved_context: str | None = None,
    ) -> str:
        system_instruction = build_system_instruction(project, retrieved_context)
        if model.provider == "openai":
            return await self._generate_openai(model, system_instruction, messages)
        if model.provider == "google":
            return await self._generate_gemini(model, system_instruction, messages)
        if model.provider == "anthropic":
            return await self._generate_anthropic(model, system_instruction, messages)
        raise AIProviderError("The selected AI provider is not supported.")

    async def _post(self, url: str, headers: dict[str, str], payload: dict) -> dict:
        attempts = self.settings.ai_runtime_max_retries
        for attempt in range(1, attempts + 1):
            try:
                async with httpx.AsyncClient(timeout=self.settings.ai_runtime_timeout_seconds) as client:
                    response = await client.post(url, headers=headers, json=payload)
                    response.raise_for_status()
                    return response.json()
            except httpx.TimeoutException as error:
                if attempt < attempts:
                    await asyncio.sleep(attempt)
                    continue
                raise AIProviderError("The AI provider timed out. Please try again.") from error
            except httpx.HTTPStatusError as error:
                status_code = error.response.status_code
                logger.warning("AI provider request failed with status %s", status_code)
                if status_code in {401, 403}:
                    raise AIProviderError("The AI provider credentials are invalid or unavailable.") from error
                if status_code in RETRYABLE_STATUS_CODES:
                    if attempt < attempts:
                        await asyncio.sleep(attempt)
                        continue
                    raise AIProviderError(
                        "The AI provider is busy. Please try again.", retryable=True
                    ) from error
                raise AIProviderError("The AI provider could not complete the request.") from error
            except httpx.HTTPError as error:
                if attempt < attempts:
                    await asyncio.sleep(attempt)
                    continue
                logger.exception("AI provider request failed")
                raise AIProviderError("The AI provider is temporarily unavailable.", retryable=True) from error
        raise AIProviderError("The AI provider is temporarily unavailable.", retryable=True)

    async def _call_gemini(self, external_model_id: str, payload: dict) -> dict:
        return await self._post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{external_model_id}:generateContent",
            {"x-goog-api-key": self.settings.gemini_api_key or ""},
            payload,
        )

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Embeds text with Gemini. Retrieval always uses this model regardless of chat provider."""
        if not self.settings.gemini_api_key:
            raise AIProviderError("Embeddings require GEMINI_API_KEY to be configured.")
        if not texts:
            return []

        model = self.settings.embedding_model
        requests = [
            {
                "model": f"models/{model}",
                "content": {"parts": [{"text": text}]},
                "outputDimensionality": self.settings.embedding_dimensions,
            }
            for text in texts
        ]
        response = await self._post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:batchEmbedContents",
            {"x-goog-api-key": self.settings.gemini_api_key},
            {"requests": requests},
        )
        vectors = [item.get("values") or [] for item in response.get("embeddings", [])]
        if len(vectors) != len(texts) or any(not vector for vector in vectors):
            raise AIProviderError("The embedding provider returned an incomplete response.")
        return vectors

    async def _generate_openai(
        self, model: AIModel, instructions: str, messages: list[RuntimeMessage]
    ) -> str:
        if not self.settings.openai_api_key:
            raise AIProviderError("OpenAI is not configured for this environment.")
        payload = {
            "model": model.external_model_id,
            "instructions": instructions,
            "input": [{"role": item.role, "content": item.content} for item in messages],
        }
        response = await self._post(
            "https://api.openai.com/v1/responses",
            {"Authorization": f"Bearer {self.settings.openai_api_key}"},
            payload,
        )
        output_text = response.get("output_text")
        if isinstance(output_text, str) and output_text.strip():
            return output_text.strip()
        return self._extract_openai_text(response)

    async def _generate_gemini(
        self, model: AIModel, instructions: str, messages: list[RuntimeMessage]
    ) -> str:
        if not self.settings.gemini_api_key:
            raise AIProviderError("Gemini is not configured for this environment.")
        contents = [
            {"role": "model" if item.role == "assistant" else "user", "parts": [{"text": item.content}]}
            for item in messages
        ]
        payload = {"systemInstruction": {"parts": [{"text": instructions}]}, "contents": contents}

        try:
            response = await self._call_gemini(model.external_model_id, payload)
        except AIProviderError as error:
            fallback = self.settings.gemini_fallback_model
            if not error.retryable or not fallback or fallback == model.external_model_id:
                raise
            # The newest Flash model is periodically saturated; fall back so a saturated
            # upstream never turns into a dead chat.
            logger.warning("Gemini model %s unavailable, falling back to %s", model.external_model_id, fallback)
            response = await self._call_gemini(fallback, payload)

        try:
            text = "".join(
                part["text"]
                for part in response["candidates"][0]["content"]["parts"]
                if isinstance(part.get("text"), str)
            ).strip()
        except (IndexError, KeyError, TypeError) as error:
            raise AIProviderError("Gemini returned an empty response.") from error
        if not text:
            raise AIProviderError("Gemini returned an empty response.")
        return text

    async def _generate_anthropic(
        self, model: AIModel, instructions: str, messages: list[RuntimeMessage]
    ) -> str:
        if not self.settings.anthropic_api_key:
            raise AIProviderError("Anthropic is not configured for this environment.")
        response = await self._post(
            "https://api.anthropic.com/v1/messages",
            {
                "x-api-key": self.settings.anthropic_api_key,
                "anthropic-version": "2023-06-01",
            },
            {
                "model": model.external_model_id,
                "max_tokens": 2048,
                "system": instructions,
                "messages": [{"role": item.role, "content": item.content} for item in messages],
            },
        )
        text = "".join(
            block.get("text", "") for block in response.get("content", []) if block.get("type") == "text"
        ).strip()
        if not text:
            raise AIProviderError("Anthropic returned an empty response.")
        return text

    @staticmethod
    def _extract_openai_text(response: dict) -> str:
        fragments: list[str] = []
        for output in response.get("output", []):
            for content in output.get("content", []):
                if content.get("type") in {"output_text", "text"} and isinstance(content.get("text"), str):
                    fragments.append(content["text"])
        text = "".join(fragments).strip()
        if not text:
            raise AIProviderError("OpenAI returned an empty response.")
        return text
