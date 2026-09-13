import postgres from "postgres";

import { LOCAL_OWNER_VALUE, type OwnerId } from "@/lib/studio/owner";
import {
  StorageUnavailableError,
  type DocumentDraft,
  type StudioDocument,
  type StudioStore,
  type StudioThread,
  type ThreadSummary,
} from "@/lib/studio/store/contract";
import { newId } from "@/lib/studio/store/ids";
import type { DocumentKind, StudioMessage } from "@/lib/studio/types";

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
 *
 * Владелец здесь — колонка owner_id, и она входит в тот же where, что и id:
 * `where id = ${id} and owner_id = ${owner}`. Достать строку по id, а потом
 * сверить владельца — это тот самый баг, ради которого шаблон и существует.
 * У фрагментов изоляция вдобавок структурная: составной внешний ключ
 * (document_id, owner_id) не даёт фрагменту принадлежать не тому, кому
 * принадлежит его документ, чем бы ни ошиблось приложение.
 */

type Row = Record<string, unknown>;

let client: postgres.Sql | null = null;
let schemaReady: Promise<void> | null = null;

/**
 * Ключ блокировки для перевода схемы на владельцев.
 *
 * Холодных стартов на бессерверной площадке бывает несколько сразу, и все они
 * выполняют один и тот же DDL. Без блокировки они гонятся и за создание
 * ограничений, и — что хуже — за backfill: один дописывает owner_id, другой в
 * этот момент ставит not null. Число произвольное, важно лишь что оно одно.
 */
const SCHEMA_LOCK = 5171204983;

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
        owner_id text not null,
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
        owner_id text not null,
        document_id text not null references studio.documents(id) on delete cascade,
        position integer not null,
        title text not null,
        body text not null,
        embedding vector(768),
        search tsvector generated always as (to_tsvector('russian', body)) stored
      );

      /* Одиночный индекс по document_id остаётся: составной
         (owner_id, document_id) его не заменяет — полезный префикс у составного
         это owner_id, а не document_id. На document_id висит свой внешний ключ,
         и без этого индекса каждое удаление документа проверяет каскад
         последовательным чтением всех фрагментов, включая чужие. */
      create index if not exists chunks_document on studio.chunks (document_id);
      create index if not exists chunks_search on studio.chunks using gin (search);

      create table if not exists studio.threads (
        id text primary key,
        owner_id text not null,
        mode text not null default 'reports',
        title text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        messages jsonb not null default '[]'::jsonb
      );

      create table if not exists studio.artifacts (
        id text primary key,
        owner_id text not null,
        markdown text not null,
        created_at timestamptz not null default now()
      );

      create table if not exists studio.nodes (
        id text primary key,
        owner_id text not null,
        parent_id text references studio.nodes(id) on delete cascade,
        kind text not null,
        name text not null,
        content text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);

    /* Перевод схемы на владельцев.
       Всё одной транзакцией под advisory-блокировкой: на бессерверной площадке
       холодных стартов бывает несколько сразу, и без неё два процесса
       одновременно доливают owner_id и ставят not null на полупустой колонке.
       Блокировка именно xact-варианта — она снимается вместе с транзакцией, и
       оборвавшееся соединение не оставляет схему запертой навсегда.

       На чистой базе весь блок — набор no-op: колонки уже созданы выше. Он
       нужен тем, у кого таблицы появились до разделения; их строки достаются
       владельцу LOCAL_OWNER_VALUE, потому что до разделения все они и были его. */
    await db.begin(async (tx) => {
      await tx.unsafe(`
        select pg_advisory_xact_lock(${SCHEMA_LOCK});

        alter table studio.documents add column if not exists owner_id text;
        alter table studio.chunks    add column if not exists owner_id text;
        alter table studio.threads   add column if not exists owner_id text;
        alter table studio.artifacts add column if not exists owner_id text;
        alter table studio.nodes     add column if not exists owner_id text;

        update studio.documents set owner_id = '${LOCAL_OWNER_VALUE}' where owner_id is null;
        update studio.threads   set owner_id = '${LOCAL_OWNER_VALUE}' where owner_id is null;
        update studio.artifacts set owner_id = '${LOCAL_OWNER_VALUE}' where owner_id is null;
        update studio.nodes     set owner_id = '${LOCAL_OWNER_VALUE}' where owner_id is null;

        /* Фрагмент наследует владельца своего документа, а не общего: документы
           могли быть розданы вручную ещё до этого запуска. */
        update studio.chunks c set owner_id = d.owner_id
        from studio.documents d
        where d.id = c.document_id and c.owner_id is null;
        update studio.chunks set owner_id = '${LOCAL_OWNER_VALUE}' where owner_id is null;

        alter table studio.documents alter column owner_id set not null;
        alter table studio.chunks    alter column owner_id set not null;
        alter table studio.threads   alter column owner_id set not null;
        alter table studio.artifacts alter column owner_id set not null;
        alter table studio.nodes     alter column owner_id set not null;

        /* add constraint if not exists в Postgres нет, поэтому наличие
           проверяем сами по pg_constraint — как if not exists у всего
           остального блока.

           Ловить исключение здесь нельзя вслепую: SQLSTATE у повтора зависит от
           вида ограничения. unique заводит под собой индекс и на повторе падает
           как duplicate_table (42P07, «relation already exists»), а внешний ключ
           ниже — как duplicate_object (42710). Проверка по каталогу от этой
           разницы не зависит и не требует угадывать код.

           Гонки между проверкой и alter нет: блок идёт под advisory-блокировкой,
           взятой выше в этой же транзакции, так что второй холодный старт ждёт
           здесь, а не выполняет alter одновременно. */
        do $$ begin
          if not exists (
            select 1 from pg_constraint
            where conrelid = 'studio.documents'::regclass and conname = 'documents_id_owner'
          ) then
            alter table studio.documents add constraint documents_id_owner unique (id, owner_id);
          end if;
        end $$;

        /* Владелец фрагмента обязан совпадать с владельцем документа — это
           проверяет база, а не приложение. Ошибка в коде выборки теперь не
           может выдать чужой фрагмент: его просто некуда было бы записать. */
        do $$ begin
          if not exists (
            select 1 from pg_constraint
            where conrelid = 'studio.chunks'::regclass and conname = 'chunks_owner_fk'
          ) then
            alter table studio.chunks add constraint chunks_owner_fk
              foreign key (document_id, owner_id)
              references studio.documents (id, owner_id) on delete cascade;
          end if;
        end $$;

        create index if not exists documents_owner on studio.documents (owner_id);
        /* Составной индекс — для выборок владельца. Одиночный chunks_document
           он не отменяет: тот обслуживает внешний ключ по document_id и
           заводится вместе с таблицей выше. */
        create index if not exists chunks_owner_document on studio.chunks (owner_id, document_id);
        create index if not exists threads_owner on studio.threads (owner_id, updated_at desc);
        create index if not exists artifacts_owner on studio.artifacts (owner_id);
        create index if not exists nodes_owner on studio.nodes (owner_id);
      `);
    });

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

export function createPostgresStore(owner: OwnerId): StudioStore {
  return {
    label: "Postgres",

    async listDocuments() {
      const conn = await db();
      const rows = await conn`
        select id, title, kind, origin, chars, chunks, indexed, created_at
        from studio.documents
        where owner_id = ${owner}
        order by (kind = 'business') desc, created_at asc
      `;
      return rows.map(toDocument);
    },

    async readDocumentText(id) {
      const conn = await db();
      const rows = await conn`select body from studio.documents where id = ${id} and owner_id = ${owner}`;
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
        insert into studio.documents (id, owner_id, title, kind, origin, body, chars, chunks, indexed, created_at)
        values (
          ${document.id}, ${owner}, ${document.title}, ${document.kind}, ${conn.json(document.origin)},
          ${text}, ${document.chars}, 0, 'keywords', ${document.createdAt}
        )
        on conflict (id) do update set
          title = excluded.title,
          kind = excluded.kind,
          origin = excluded.origin,
          body = excluded.body,
          chars = excluded.chars
        /* Идентификатор занят чужим документом — не трогаем ничего. Перебить
           чужую строку своей было бы хуже любого отказа. */
        where studio.documents.owner_id = ${owner}
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
        where id = ${id} and owner_id = ${owner}
        returning id, title, kind, origin, chars, chunks, indexed, created_at
      `;
      return rows.length ? toDocument(rows[0]) : null;
    },

    async deleteDocument(id) {
      const conn = await db();
      await conn`delete from studio.documents where id = ${id} and owner_id = ${owner}`;
    },

    async saveChunks(documentId, title, chunks, vectors) {
      const conn = await db();
      const usable = vectors && vectors.length === chunks.length ? vectors : null;

      await conn.begin(async (tx) => {
        /* Документ проверяется в той же транзакции, что и запись фрагментов:
           чужой идентификатор не должен ни стереть чужие фрагменты, ни завести
           свои под чужим документом. Нет документа — тихо выходим, ровно как и
           при несуществующем: отличать «чужой» от «нет такого» незачем. */
        const owned = await tx`select 1 from studio.documents where id = ${documentId} and owner_id = ${owner}`;
        if (!owned.length) return;

        await tx`delete from studio.chunks where document_id = ${documentId} and owner_id = ${owner}`;
        if (!chunks.length) return;

        /* Вставка пачкой: у длинного документа сотни фрагментов, и по одному
           запросу на каждый — это сотни круговых поездок к базе. */
        const payload = chunks.map((body, position) => ({
          owner_id: owner,
          document_id: documentId,
          position,
          title,
          body,
          embedding: usable ? toVectorLiteral(usable[position]) : null,
        }));

        for (let offset = 0; offset < payload.length; offset += 100) {
          await tx`insert into studio.chunks ${tx(payload.slice(offset, offset + 100), "owner_id", "document_id", "position", "title", "body", "embedding")}`;
        }
      });
    },

    async searchChunks(query, limit) {
      const conn = await db();

      /* owner_id в обоих where — это граница между арендаторами, а не
         оптимизация. Убрать его ради скорости значит показать чужие документы:
         если запрос понадобится ускорить, ускоряется всё остальное. */
      if (query.vector) {
        const rows = await conn`
          select document_id, title, body, 1 - (embedding <=> ${toVectorLiteral(query.vector)}::vector) as score
          from studio.chunks
          where owner_id = ${owner} and embedding is not null
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
        where owner_id = ${owner} and search @@ websearch_to_tsquery('russian', ${query.text})
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
        select
          id,
          title,
          updated_at,
          jsonb_array_length(messages) as messages,
          (
            select count(*)
            from jsonb_array_elements(messages) as message
            where message->>'role' = 'agent' and coalesce(message->>'mode', 'report') <> 'chat'
          ) as reports
        from studio.threads
        where owner_id = ${owner}
        order by updated_at desc
      `;
      return rows.map((row) => ({
        id: String(row.id),
        title: String(row.title),
        updatedAt: new Date(row.updated_at as string).toISOString(),
        messages: Number(row.messages ?? 0),
        reports: Number(row.reports ?? 0),
      }));
    },

    async readThread(id) {
      const conn = await db();
      const rows = await conn`
        select id, title, created_at, updated_at, messages from studio.threads where id = ${id} and owner_id = ${owner}
      `;
      return rows.length ? toThread(rows[0]) : null;
    },

    async saveThread(thread) {
      const conn = await db();
      await conn`
        insert into studio.threads (id, owner_id, title, created_at, updated_at, messages)
        values (${thread.id}, ${owner}, ${thread.title}, ${thread.createdAt}, ${thread.updatedAt}, ${conn.json(thread.messages)})
        on conflict (id) do update set
          title = excluded.title,
          updated_at = excluded.updated_at,
          messages = excluded.messages
        where studio.threads.owner_id = ${owner}
      `;
    },

    async deleteThread(id) {
      const conn = await db();
      await conn`delete from studio.threads where id = ${id} and owner_id = ${owner}`;
    },

    async saveArtifact(id, markdown) {
      const conn = await db();
      await conn`
        insert into studio.artifacts (id, owner_id, markdown) values (${id}, ${owner}, ${markdown})
        on conflict (id) do update set markdown = excluded.markdown
        where studio.artifacts.owner_id = ${owner}
      `;
    },

    async readArtifact(id) {
      const conn = await db();
      const rows = await conn`select markdown from studio.artifacts where id = ${id} and owner_id = ${owner}`;
      return rows.length ? String(rows[0].markdown) : null;
    },

    /* ---------- Проект ---------- */

    async listNodes() {
      const conn = await db();
      const rows = await conn`
        select id, parent_id, kind, name, created_at, updated_at,
               case when kind = 'file' then coalesce(length(content), 0) else null end as chars
        from studio.nodes where owner_id = ${owner} order by name asc
      `;
      return rows.map((row) => ({
        id: String(row.id),
        parentId: row.parent_id === null ? null : String(row.parent_id),
        kind: row.kind === "folder" ? ("folder" as const) : ("file" as const),
        name: String(row.name),
        createdAt: new Date(row.created_at as string).toISOString(),
        updatedAt: new Date(row.updated_at as string).toISOString(),
        chars: row.chars === null ? null : Number(row.chars),
      }));
    },

    async saveNode(node, content) {
      const conn = await db();
      /* Родитель проверяется отдельно: внешний ключ у nodes одноколоночный и
         про владельца ничего не знает, поэтому без проверки чужая папка годилась
         бы в родители. Исключение, а не тихий отказ: сюда доходят только мимо
         проверки дерева в обработчике, а это ошибка кода, а не ввода. */
      if (node.parentId !== null) {
        const parent = await conn`select 1 from studio.nodes where id = ${node.parentId} and owner_id = ${owner}`;
        if (!parent.length) throw new Error("Родительская папка не найдена.");
      }

      /* content = null означает «не трогать»: переименование не должно
         стирать текст отчёта. Поэтому coalesce на исключённом значении. */
      await conn`
        insert into studio.nodes (id, owner_id, parent_id, kind, name, content, updated_at)
        values (${node.id}, ${owner}, ${node.parentId}, ${node.kind}, ${node.name}, ${content}, now())
        on conflict (id) do update set
          parent_id = excluded.parent_id,
          name = excluded.name,
          content = coalesce(excluded.content, studio.nodes.content),
          updated_at = now()
        where studio.nodes.owner_id = ${owner}
      `;
      return { ...node, chars: node.kind === "folder" ? null : content !== null ? content.length : node.chars };
    },

    async readNodeContent(id) {
      const conn = await db();
      const rows = await conn`select content from studio.nodes where id = ${id} and owner_id = ${owner}`;
      return rows.length && rows[0].content !== null ? String(rows[0].content) : null;
    },

    async deleteNode(id) {
      const conn = await db();
      await conn`delete from studio.nodes where id = ${id} and owner_id = ${owner}`;
    },
  };
}
