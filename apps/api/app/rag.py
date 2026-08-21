import json
import math
import re
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_runtime import AIProviderRuntime
from app.config import Settings
from app.models import Document, DocumentChunk

PARAGRAPH_BREAK = re.compile(r"\n\s*\n")


@dataclass(frozen=True)
class RetrievedChunk:
    title: str
    ordinal: int
    content: str
    score: float


def chunk_text(text: str, chunk_chars: int, overlap_chars: int) -> list[str]:
    """Splits on paragraph boundaries first, falling back to hard slices for long blocks."""
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return []

    blocks = [block.strip() for block in PARAGRAPH_BREAK.split(normalized) if block.strip()]
    chunks: list[str] = []
    buffer = ""

    def flush() -> None:
        nonlocal buffer
        if buffer.strip():
            chunks.append(buffer.strip())
        buffer = ""

    for block in blocks:
        while len(block) > chunk_chars:
            flush()
            chunks.append(block[:chunk_chars].strip())
            block = block[max(chunk_chars - overlap_chars, 1):]
        if not buffer:
            buffer = block
        elif len(buffer) + len(block) + 2 <= chunk_chars:
            buffer = f"{buffer}\n\n{block}"
        else:
            flush()
            buffer = block
    flush()

    if overlap_chars and len(chunks) > 1:
        overlapped = [chunks[0]]
        for index in range(1, len(chunks)):
            tail = chunks[index - 1][-overlap_chars:]
            overlapped.append(f"{tail}\n\n{chunks[index]}" if tail else chunks[index])
        return overlapped
    return chunks


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right, strict=True))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0
    return dot / (left_norm * right_norm)


async def index_document(
    db: AsyncSession,
    runtime: AIProviderRuntime,
    settings: Settings,
    document: Document,
    text: str,
) -> int:
    """Chunks and embeds `text`, attaching the chunks to `document`. Returns the chunk count."""
    pieces = chunk_text(text, settings.rag_chunk_chars, settings.rag_chunk_overlap_chars)
    if not pieces:
        return 0

    vectors: list[list[float]] = []
    batch_size = 32
    for start in range(0, len(pieces), batch_size):
        vectors.extend(await runtime.embed(pieces[start : start + batch_size]))

    for ordinal, (content, vector) in enumerate(zip(pieces, vectors, strict=True)):
        db.add(
            DocumentChunk(
                document_id=document.id,
                project_id=document.project_id,
                ordinal=ordinal,
                content=content,
                embedding=json.dumps(vector),
            )
        )
    return len(pieces)


async def retrieve_context(
    db: AsyncSession,
    runtime: AIProviderRuntime,
    settings: Settings,
    project_id: UUID,
    query: str,
) -> list[RetrievedChunk]:
    """Embeds the query and ranks stored chunks by cosine similarity.

    Similarity is computed in Python because this Postgres has no pgvector; the scan is
    bounded by `rag_max_scanned_chunks` so a large workspace cannot stall a chat turn.
    """
    rows = (
        await db.execute(
            select(DocumentChunk.content, DocumentChunk.ordinal, DocumentChunk.embedding, Document.title)
            .join(Document, Document.id == DocumentChunk.document_id)
            .where(DocumentChunk.project_id == project_id, DocumentChunk.embedding.is_not(None))
            .order_by(DocumentChunk.created_at.desc())
            .limit(settings.rag_max_scanned_chunks)
        )
    ).all()
    if not rows:
        return []

    query_vector = (await runtime.embed([query]))[0]

    scored: list[RetrievedChunk] = []
    for content, ordinal, embedding, title in rows:
        try:
            vector = json.loads(embedding)
        except (TypeError, ValueError):
            continue
        scored.append(
            RetrievedChunk(
                title=title,
                ordinal=ordinal,
                content=content,
                score=cosine_similarity(query_vector, vector),
            )
        )

    scored.sort(key=lambda chunk: chunk.score, reverse=True)
    return [chunk for chunk in scored[: settings.rag_top_k] if chunk.score > 0]


def format_context(chunks: list[RetrievedChunk]) -> str:
    return "\n\n".join(
        f"[{index}] Источник: {chunk.title} (фрагмент {chunk.ordinal + 1}, релевантность {chunk.score:.2f})\n{chunk.content}"
        for index, chunk in enumerate(chunks, start=1)
    )
