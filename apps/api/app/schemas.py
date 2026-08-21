from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.models import FeedbackSentiment, FeedbackSource, ReleaseStatus, UserRole, UserStatus


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    captcha_token: str | None = Field(default=None, max_length=4096)


def validate_password_policy(value: str) -> str:
    if not any(char.islower() for char in value):
        raise ValueError("Password must contain a lowercase letter")
    if not any(char.isupper() for char in value):
        raise ValueError("Password must contain an uppercase letter")
    if not any(char.isdigit() for char in value):
        raise ValueError("Password must contain a number")
    return value


class CompleteRegistrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=32, max_length=512)
    name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=12, max_length=128)
    password_confirmation: str = Field(min_length=12, max_length=128)

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return validate_password_policy(value)

    @model_validator(mode="after")
    def passwords_match(self) -> "CompleteRegistrationRequest":
        if self.password != self.password_confirmation:
            raise ValueError("Passwords do not match")
        return self


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    captcha_token: str | None = Field(default=None, max_length=4096)


class TokenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=32, max_length=512)


class SupabaseSessionRequest(BaseModel):
    """A Supabase access token, exchanged for one of this API's own sessions."""

    model_config = ConfigDict(extra="forbid")

    access_token: str = Field(min_length=20, max_length=4096)


class ForgotPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    captcha_token: str | None = Field(default=None, max_length=4096)


class ResetPasswordRequest(TokenRequest):
    password: str = Field(min_length=12, max_length=128)
    password_confirmation: str = Field(min_length=12, max_length=128)

    @model_validator(mode="after")
    def passwords_match(self) -> "ResetPasswordRequest":
        if self.password != self.password_confirmation:
            raise ValueError("Passwords do not match")
        return self

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return validate_password_policy(value)


class MessageResponse(BaseModel):
    message: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    name: str
    avatar_url: str | None
    email_verified: bool
    status: UserStatus
    role: UserRole
    created_at: datetime


class SessionResponse(BaseModel):
    id: UUID
    created_at: datetime
    last_used_at: datetime
    expires_at: datetime
    user_agent: str | None
    current: bool


class CaptchaStatusResponse(BaseModel):
    provider: str | None
    site_key: str | None


class CsrfTokenResponse(BaseModel):
    csrf_token: str


class CatalogItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    slug: str
    name: str
    description: str


class AIModelResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    key: str
    provider: str
    external_model_id: str
    display_name: str
    supports_tools: bool


class ProjectCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    ai_model_id: UUID
    system_prompt: str = Field(default="", max_length=12000)
    memory_enabled: bool = True
    skill_ids: list[UUID] = Field(default_factory=list, max_length=20)
    tool_ids: list[UUID] = Field(default_factory=list, max_length=20)

    @field_validator("name", "description", "system_prompt", mode="before")
    @classmethod
    def strip_text(cls, value: str | None) -> str | None:
        return value.strip() if isinstance(value, str) else value

    @field_validator("skill_ids", "tool_ids")
    @classmethod
    def validate_unique_ids(cls, value: list[UUID]) -> list[UUID]:
        if len(value) != len(set(value)):
            raise ValueError("Duplicate component identifiers are not allowed")
        return value


class ProjectUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    ai_model_id: UUID | None = None
    system_prompt: str | None = Field(default=None, max_length=12000)
    memory_enabled: bool | None = None
    skill_ids: list[UUID] | None = Field(default=None, max_length=20)
    tool_ids: list[UUID] | None = Field(default=None, max_length=20)

    @field_validator("name", "description", "system_prompt", mode="before")
    @classmethod
    def strip_text(cls, value: str | None) -> str | None:
        return value.strip() if isinstance(value, str) else value

    @field_validator("skill_ids", "tool_ids")
    @classmethod
    def validate_unique_ids(cls, value: list[UUID] | None) -> list[UUID] | None:
        if value is not None and len(value) != len(set(value)):
            raise ValueError("Duplicate component identifiers are not allowed")
        return value


class ProjectResponse(BaseModel):
    id: UUID
    name: str
    description: str | None
    system_prompt: str
    memory_enabled: bool
    ai_model: AIModelResponse
    skills: list[CatalogItemResponse]
    tools: list[CatalogItemResponse]
    created_at: datetime
    updated_at: datetime


class ConversationCreateRequest(BaseModel):
    title: str = Field(default="New conversation", min_length=1, max_length=160)

    @field_validator("title", mode="before")
    @classmethod
    def strip_title(cls, value: str) -> str:
        return value.strip()


class ConversationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    title: str
    created_at: datetime
    updated_at: datetime


class ConversationMessageRequest(BaseModel):
    content: str = Field(min_length=1, max_length=12000)

    @field_validator("content", mode="before")
    @classmethod
    def strip_content(cls, value: str) -> str:
        return value.strip()


class ConversationMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    conversation_id: UUID
    role: str
    content: str
    provider: str | None
    model_key: str | None
    created_at: datetime


class ConversationDetailResponse(ConversationResponse):
    messages: list[ConversationMessageResponse]


class ReleaseCreateRequest(BaseModel):
    version: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=2, max_length=200)
    summary: str = Field(default="", max_length=12000)
    status: ReleaseStatus = ReleaseStatus.RELEASED
    released_at: datetime

    @field_validator("version", "title", "summary", mode="before")
    @classmethod
    def strip_release_text(cls, value: str) -> str:
        return value.strip()


class ReleaseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    version: str
    title: str
    summary: str
    status: ReleaseStatus
    released_at: datetime
    created_at: datetime
    updated_at: datetime


class FeedbackCreateRequest(BaseModel):
    release_id: UUID | None = None
    source: FeedbackSource
    external_ref: str | None = Field(default=None, max_length=255)
    content: str = Field(min_length=2, max_length=20000)
    sentiment: FeedbackSentiment = FeedbackSentiment.NEUTRAL
    topic: str | None = Field(default=None, max_length=160)
    occurred_at: datetime

    @field_validator("external_ref", "content", "topic", mode="before")
    @classmethod
    def strip_feedback_text(cls, value: str | None) -> str | None:
        return value.strip() if isinstance(value, str) else value


class FeedbackResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    release_id: UUID | None
    source: FeedbackSource
    external_ref: str | None
    content: str
    sentiment: FeedbackSentiment
    topic: str | None
    occurred_at: datetime
    created_at: datetime
    updated_at: datetime


class MetricSnapshotCreateRequest(BaseModel):
    metric_key: str = Field(pattern=r"^[a-z0-9][a-z0-9_.-]{0,119}$")
    label: str = Field(min_length=2, max_length=160)
    value: float = Field(allow_inf_nan=False)
    unit: str | None = Field(default=None, max_length=40)
    segment: str = Field(default="all", min_length=1, max_length=120)
    measured_at: datetime

    @field_validator("metric_key", "label", "unit", "segment", mode="before")
    @classmethod
    def strip_metric_text(cls, value: str | None) -> str | None:
        return value.strip() if isinstance(value, str) else value


class MetricSnapshotResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    metric_key: str
    label: str
    value: float
    unit: str | None
    segment: str
    measured_at: datetime
    created_at: datetime
    updated_at: datetime


class DocumentCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    content: str = Field(min_length=1, max_length=1_500_000)
    source_kind: str = Field(default="upload", max_length=40)

    @field_validator("title", "content", "source_kind", mode="before")
    @classmethod
    def strip_document_text(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    title: str
    source_kind: str
    char_count: int
    chunk_count: int
    created_at: datetime
    updated_at: datetime


class RetrievedChunkResponse(BaseModel):
    title: str
    ordinal: int
    score: float
    content: str


class ConversationMessageWithSourcesResponse(ConversationMessageResponse):
    sources: list[RetrievedChunkResponse] = Field(default_factory=list)


class ProductContextSummaryResponse(BaseModel):
    releases: int
    feedback_signals: int
    metric_snapshots: int
    negative_feedback: int
    unlinked_feedback: int
