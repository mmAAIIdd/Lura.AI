import postgres from "postgres";

import {
  StorageUnavailableError,
  type ChunkHit,
  type DocumentDraft,
  type StudioDocument,
  type StudioStore,
  type StudioThread,
  type ThreadSummary,
} from "@/lib/studio/store/contract";
import { newId } from "@/lib/studio/store/ids";
import type { DocumentKind, StudioMessage, StudioMode } from "@/lib/studio/types";

/**
 * Хранилище в Postgres — то, на чём рабочее пространство живёт на Vercel.
 *
 * Таблицы лежат в схеме `studio`, а не в `public`, и это не вкусовщина:
 * PostgREST у Supabase публикует только `public`, а публикуемый ключ проекта
 * уходит в браузерный бандл. Документы команды в `public` означали бы, что их
 * читает кто угодно с этим ключом.
 *
 * Соединение идёт с `prepare: false`: на бессерверной площадке подключаться
 * положено через transaction pooler, а он не умеет подготовленные выражения.
 */

type Row = Record<string, unknown>;

let client: postgres.Sql | null = null;
let schemaReady: Promise<void> | null = null;

export function databaseUrl(): string | null {
  const url = process.env.STUDIO_DATABASE_URL?.trim();
  return url ? url : null;
}

function sql(): postgres.Sql {
  if (client) return client;
  const url = databaseUrl();
  if (!url) throw new StorageUnavailableError("STUDIO_DATABASE_URL не задан.");

  client = postgres(url, {
    prepare: false,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 15,
    /* NOTICE от `create ... if not exists` — это не событие для логов. */
    onnotice: () => {},
  });
  return client;
}

/**
 * Схема создаётся при первом обращении и только один раз за процесс.
 *
 * Весь DDL идемпотентный, поэтому отдельного шага миграции для одного
 * рабочего пространства не нужно: задал строку подключения — оно поехало.
 * Тот же SQL лежит в apps/web/supabase/studio.sql, если применять руками.
 */
async function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;

  schemaReady = (async () => {
    const db = sql();

    try {
      await db.unsafe("create extension if not exists vector");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new StorageUnavailableError(
        `Расширение pgvector не включено и не создаётся автоматически (${detail}). ` +
          "Включите его в Supabase: Database → Extensions → vector.",
      );
    }

    await db.unsafe(`
      create schema if not exists studio;

      create table if not exists studio.documents (
        id text primary key,
        title text not null,
        kind text not null check (kind in ('business', 'source')),
        origin jsonb not null default '{}'::jsonb,
        body text not null default '',
        chars integer not null default 0,
        chunks integer not null default 0,
        indexed text not null default 'keywords',
        created_at timestamptz not null default now()
      );

      create table if not exists studio.chunks (
        id bigserial primary key,
        document_id text not null references studio.documents(id) on delete cascade,
        position integer not null,
        title text not null,
        body text not null,
        embedding vector(768),
        search tsvector generated always as (to_tsvector('russian', body)) stored
      );

      create index if not exists chunks_document on studio.chunks (document_id);
      create index if not exists chunks_search on studio.chunks using gin (search);

      create table if not exists studio.threads (
        id text primary key,
        mode text not null default 'reports',
        title text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        messages jsonb not null default '[]'::jsonb
      );

      create table if not exists studio.artifacts (
        id text primary key,
        markdown text not null,
        created_at timestamptz not null default now()
      );
    `);

    /* Индекс по векторам отдельно: на старом pgvector нет hnsw, и ронять из-за
       этого всё хранилище незачем — поиск работает и последовательным чтением. */
    await db
      .unsafe("create index if not exists chunks_embedding on studio.chunks using hnsw (embedding vector_cosine_ops)")
      .catch(() => undefined);
  })().catch((error) => {
    /* Неудачная попытка не должна закешироваться: следующий запрос попробует
       снова, иначе один сетевой сбой при старте выключает пространство до
       перезапуска процесса. */
    schemaReady = null;
    throw error;
  });

  return schemaReady;
}

async function db(): Promise<postgres.Sql> {
  await ensureSchema();
  return sql();
}

function toDocument(row: Row): StudioDocument {
  return {
    id: String(row.id),
    title: String(row.title),
    kind: String(row.kind) as DocumentKind,
    origin: (row.origin ?? {}) as StudioDocument["origin"],
    chars: Number(row.chars ?? 0),
    chunks: Number(row.chunks ?? 0),
    indexed: (row.indexed === "embeddings" ? "embeddings" : "keywords") as StudioDocument["indexed"],
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

function toThread(row: Row): StudioThread {
  return {
    id: String(row.id),
    mode: (row.mode === "updates" ? "updates" : "reports") as StudioMode,
    title: String(row.title),
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    messages: (row.messages ?? []) as StudioMessage[],
  };
}

/** pgvector принимает вектор текстом: '[0.1,0.2,...]'. */
function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

export function createPostgresStore(): StudioStore {
  return {
    label: "Postgres (Supabase)",

    async listDocuments() {
      const conn = await db();
      const rows = await conn`
        select id, title, kind, origin, chars, chunks, indexed, created_at
        from studio.documents
        order by (kind = 'business') desc, created_at asc
      `;
      return rows.map(toDocument);
    },

    async readDocumentText(id) {
      const conn = await db();
      const rows = await conn`select body from studio.documents where id = ${id}`;
      return rows.length ? String(rows[0].body ?? "") : "";
    },

    async saveDocument(draft: DocumentDraft, text) {
      const conn = await db();
      const document: StudioDocument = {
        id: draft.id ?? newId(),
        title: draft.title,
        kind: draft.kind,
        origin: draft.origin,
        chars: text.length,
        chunks: 0,
        indexed: "keywords",
        createdAt: new Date().toISOString(),
      };

      await conn`
        insert into studio.documents (id, title, kind, origin, body, chars, chunks, indexed, created_at)
        values (
          ${document.id}, ${document.title}, ${document.kind}, ${conn.json(document.origin)},
          ${text}, ${document.chars}, 0, 'keywords', ${document.createdAt}
        )
        on conflict (id) do update set
          title = excluded.title,
          kind = excluded.kind,
          origin = excluded.origin,
          body = excluded.body,
          chars = excluded.chars
      `;
      return document;
    },

    async updateDocument(id, patch) {
      const conn = await db();
      const rows = await conn`
        update studio.documents set
          title = coalesce(${patch.title ?? null}, title),
          kind = coalesce(${patch.kind ?? null}, kind),
          chunks = coalesce(${patch.chunks ?? null}, chunks),
          indexed = coalesce(${patch.indexed ?? null}, indexed)
        where id = ${id}
        returning id, title, kind, origin, chars, chunks, indexed, created_at
      `;
      return rows.length ? toDocument(rows[0]) : null;
    },

    async deleteDocument(id) {
      const conn = await db();
      await conn`delete from studio.documents where id = ${id}`;
    },

    async saveChunks(documentId, title, chunks, vectors) {
      const conn = await db();
      const usable = vectors && vectors.length === chunks.length ? vectors : null;

      await conn.begin(async (tx) => {
        await tx`delete from studio.chunks where document_id = ${documentId}`;
        if (!chunks.length) return;

        /* Вставка пачкой: у длинного документа сотни фрагментов, и по одному
           запросу на каждый — это сотни круговых поездок к базе. */
        const payload = chunks.map((body, position) => ({
          document_id: documentId,
          position,
          title,
          body,
          embedding: usable ? toVectorLiteral(usable[position]) : null,
        }));

        for (let offset = 0; offset < payload.length; offset += 100) {
          await tx`insert into studio.chunks ${tx(payload.slice(offset, offset + 100), "document_id", "position", "title", "body", "embedding")}`;
        }
      });
    },

    async searchChunks(query, limit) {
      const conn = await db();

      if (query.vector) {
        const rows = await conn`
          select document_id, title, body, 1 - (embedding <=> ${toVectorLiteral(query.vector)}::vector) as score
          from studio.chunks
          where embedding is not null
          order by embedding <=> ${toVectorLiteral(query.vector)}::vector
          limit ${limit}
        `;
        if (rows.length) {
          return rows.map((row) => ({
            documentId: String(row.document_id),
            title: String(row.title),
            text: String(row.body),
            score: Number(row.score ?? 0),
          }));
        }
      }

      const rows = await conn`
        select document_id, title, body, ts_rank(search, websearch_to_tsquery('russian', ${query.text})) as score
        from studio.chunks
        where search @@ websearch_to_tsquery('russian', ${query.text})
        order by score desc
        limit ${limit}
      `;

      return rows.map((row) => ({
        documentId: String(row.document_id),
        title: String(row.title),
        text: String(row.body),
        score: Number(row.score ?? 0),
      }));
    },

    async listThreads(): Promise<ThreadSummary[]> {
      const conn = await db();
      const rows = await conn`
        select id, mode, title, updated_at, jsonb_array_length(messages) as messages
        from studio.threads
        order by updated_at desc
      `;
      return rows.map((row) => ({
        id: String(row.id),
        mode: (row.mode === "updates" ? "updates" : "reports") as StudioMode,
        title: String(row.title),
        updatedAt: new Date(row.updated_at as string).toISOString(),
        messages: Number(row.messages ?? 0),
      }));
    },

    async readThread(id) {
      const conn = await db();
      const rows = await conn`
        select id, mode, title, created_at, updated_at, messages from studio.threads where id = ${id}
      `;
      return rows.length ? toThread(rows[0]) : null;
    },

    async saveThread(thread) {
      const conn = await db();
      await conn`
        insert into studio.threads (id, mode, title, created_at, updated_at, messages)
        values (${thread.id}, ${thread.mode}, ${thread.title}, ${thread.createdAt}, ${thread.updatedAt}, ${conn.json(thread.messages)})
        on conflict (id) do update set
          mode = excluded.mode,
          title = excluded.title,
          updated_at = excluded.updated_at,
          messages = excluded.messages
      `;
    },

    async deleteThread(id) {
      const conn = await db();
      await conn`delete from studio.threads where id = ${id}`;
    },

    async saveArtifact(id, markdown) {
      const conn = await db();
      await conn`
        insert into studio.artifacts (id, markdown) values (${id}, ${markdown})
        on conflict (id) do update set markdown = excluded.markdown
      `;
    },

    async readArtifact(id) {
      const conn = await db();
      const rows = await conn`select markdown from studio.artifacts where id = ${id}`;
      return rows.length ? String(rows[0].markdown) : null;
    },
  };
}
