---
name: lura-ai-runtime-rag
description: Lura's two independent AI runtimes and their retrieval layers — the Studio agent loop in apps/web/lib/studio with Gemini, tool declarations, chunking and pgvector/cosine search, and the backend provider runtime in apps/api/app/ai_runtime.py with app/rag.py. Use when changing agent behaviour, prompts, tools, retrieval, chunking, embeddings, streaming or provider handling.
---

# Lura AI runtimes

Two runtimes, independent of each other. Identify which one a task concerns before
touching anything — they share vocabulary and almost no code.

## Studio runtime — `apps/web/lib/studio/**`

Runs inside the Next.js app. Needs no `apps/api`, no Postgres service, no Redis, no Python.
Its one external dependency is the Gemini API.

| File | Owns |
|---|---|
| `agent.ts` | the agent loop: model calls tools, results are fed back, events stream up |
| `gemini.ts` | `streamTurn`, `embedTexts`, `GeminiError` |
| `prompt.ts` | `buildSystemInstruction` |
| `command.ts` | `parsePrompt`, run mode |
| `tools.ts` | `TOOL_DECLARATIONS`, `runTool` |
| `rag.ts` | `indexDocument`, chunking + embeddings |
| `text.ts` | `splitIntoChunks` |
| `store/` | `contract.ts` · `files.ts` · `postgres.ts` · `index.ts` (backend selection) |
| `config.ts` | limits, round budgets, `modelChain`, the public model names |
| `search.ts` | external search provider chain |
| `review.ts`, `table.ts`, `chart.ts`, `project*.ts` | analysis and project-file output |

**Tools the agent can call** (`TOOL_DECLARATIONS`): `web_search`, `fetch_url`,
`search_documents`, `read_document`, `analyze_table`, `count_groups`, `list_project`,
`read_project_file`, `create_folder`, `write_project_file`. Every call is executed in
`agent.ts` and returned to the model as a result — the model never reaches outside this
loop. Adding a tool means a declaration **and** a `runTool` branch **and** a `ToolTrace`,
or the UI shows a call that never resolves.

**Design rules already encoded here — preserve them:**

- **Budgets are finite.** `MAX_TOOL_ROUNDS`, `MAX_CHAT_TOOL_ROUNDS` and a wall-clock budget
  exist so the agent finishes on what it has instead of searching forever. An unfinished
  analysis is useless however complete it promised to be.
- **Degrade, never disable.** If embeddings are unavailable (no key, quota exhausted) the
  document is still indexed and search falls back to keywords. If no search provider
  answers, the agent says external sources could not be collected — it does not invent
  links. Keep that shape for any new capability.
- **One business document** goes into the system instruction in full on every request; the
  rest are chunked, embedded with the Gemini embedding model and retrieved by cosine
  similarity. File store computes cosine in the app; Postgres does it with pgvector.
- **Public model names only.** `lura-pro` and `lura-fast`. The provider model behind them
  must not reach the UI, stream events, downloadable reports or the agent's answers.
- **Report structure is a contract.** Six sections: what changed, what happened after,
  problems found, why it could have happened, what to do, how to verify. Facts, then
  analysis, then hypotheses, then recommendations.
- **Storage is chosen once** in `store/index.ts` — `STUDIO_DATABASE_URL` means Postgres,
  otherwise files under `.lura-studio/`. Never mix both in one run. `storageIsEphemeral()`
  exists so the UI can warn instead of silently losing an upload.
- `maxDuration = 300` on `app/api/studio/run/route.ts`. A run takes 20 seconds to several
  minutes.

Comments in this subsystem are in Russian and explain rationale at length. Match that.

## Backend runtime — `apps/api/app/ai_runtime.py`

Separate and provider-configurable. `config.py` carries `openai_api_key`, `gemini_api_key`
and `anthropic_api_key` — **all three are product features. Never remove one.** The
Claude-only rule governs the developer agents in `.claude/`, not this code.

- `build_system_instruction(project, retrieved_context)` assembles project name, system
  prompt, enabled skills, configured tools and retrieved context. It explicitly instructs
  the model not to claim a tool was used unless its result was supplied.
- Retries are bounded: `RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}`,
  `ai_runtime_max_retries`, `ai_runtime_timeout_seconds`, and `gemini_fallback_model` for
  when the newest Flash model is saturated upstream.
- `AIProviderError` carries a `retryable` flag and is safe to return to an authenticated
  caller. Do not surface raw provider errors — they leak upstream detail.
- `app/rag.py` does its own chunking (`chunk_text`, paragraph-first with hard-slice
  fallback) over `Document` / `DocumentChunk`. Settings: `rag_chunk_chars`,
  `rag_chunk_overlap_chars`, `rag_top_k`, `embedding_model`, `embedding_dimensions`.

## Never

- Log or echo a prompt containing user documents, or an API key.
- Hardcode a provider model id in the UI layer.
- Remove a fallback path to "simplify" — each one exists because the upstream fails.
- Assume a change to one runtime applies to the other.
