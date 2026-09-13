-- Схема рабочего пространства Lura Studio.
--
-- Приложение создаёт всё это само при первом обращении, если задан
-- STUDIO_DATABASE_URL. Файл нужен для двух случаев: когда у роли подключения
-- нет прав на DDL и когда схему хочется завести заранее и посмотреть глазами.
--
-- Схема называется studio, а не public, и это не вкусовщина: PostgREST у
-- Supabase публикует только public, а публикуемый ключ проекта уходит в
-- браузерный бандл. Документы команды в public означали бы, что их читает
-- кто угодно с этим ключом.
--
-- owner_id есть в каждой таблице, и это граница между владельцами, а не
-- пометка. Приложение подставляет его в тот же where, что и id. Значения по
-- умолчанию у колонки нет намеренно: забытая колонка при вставке должна
-- ломать запрос, а не тихо записывать строку в общее пространство.

create extension if not exists vector;

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

-- 768 измерений — столько отдаёт gemini-embedding-001 с outputDimensionality 768.
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

-- Индекс под внешний ключ по document_id. Составной (owner_id, document_id)
-- ниже его не заменяет: полезный префикс у составного — owner_id. Без этого
-- индекса удаление документа проверяет каскад последовательным чтением всех
-- фрагментов, включая чужие.
create index if not exists chunks_document on studio.chunks (document_id);
create index if not exists chunks_search on studio.chunks using gin (search);

-- Поиск по смыслу. Если pgvector старше 0.5 и hnsw недоступен, индекс можно не
-- создавать: запрос отработает последовательным чтением.
create index if not exists chunks_embedding on studio.chunks using hnsw (embedding vector_cosine_ops);

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

-- Дерево проекта: папки и файлы отчётов. Раньше этой таблицы в файле не было —
-- расхождение с кодом, которое чинится здесь заодно.
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

-- ---------------------------------------------------------------------------
-- Перевод уже работающей базы на владельцев.
--
-- Тот же блок выполняет и приложение при старте, поэтому файл безопасно
-- применять к непустой схеме: на свежей всё ниже — набор no-op. Строки, у
-- которых владельца ещё нет, достаются 'local': до разделения они все
-- принадлежали одному открытому пространству, и другого честного ответа нет.
--
-- Переселить их потом к настоящему пользователю — один update с его sub из
-- Supabase (auth.users.id), по всем пяти таблицам сразу:
--
--   update studio.documents set owner_id = '<sub>' where owner_id = 'local';
--   update studio.chunks     set owner_id = '<sub>' where owner_id = 'local';
--   update studio.threads    set owner_id = '<sub>' where owner_id = 'local';
--   update studio.artifacts  set owner_id = '<sub>' where owner_id = 'local';
--   update studio.nodes      set owner_id = '<sub>' where owner_id = 'local';
--
-- documents и chunks — одной транзакцией: составной внешний ключ ниже требует,
-- чтобы владелец фрагмента совпадал с владельцем его документа.
-- ---------------------------------------------------------------------------

begin;

-- Блокировка на случай, когда файл применяют руками, пока приложение уже
-- поднимается: оба выполняют один и тот же DDL и гонятся за backfill.
select pg_advisory_xact_lock(5171204983);

alter table studio.documents add column if not exists owner_id text;
alter table studio.chunks    add column if not exists owner_id text;
alter table studio.threads   add column if not exists owner_id text;
alter table studio.artifacts add column if not exists owner_id text;
alter table studio.nodes     add column if not exists owner_id text;

update studio.documents set owner_id = 'local' where owner_id is null;
update studio.threads   set owner_id = 'local' where owner_id is null;
update studio.artifacts set owner_id = 'local' where owner_id is null;
update studio.nodes     set owner_id = 'local' where owner_id is null;

-- Фрагмент наследует владельца своего документа, а не общего: документы могли
-- быть розданы вручную ещё раньше.
update studio.chunks c set owner_id = d.owner_id
from studio.documents d
where d.id = c.document_id and c.owner_id is null;
update studio.chunks set owner_id = 'local' where owner_id is null;

alter table studio.documents alter column owner_id set not null;
alter table studio.chunks    alter column owner_id set not null;
alter table studio.threads   alter column owner_id set not null;
alter table studio.artifacts alter column owner_id set not null;
alter table studio.nodes     alter column owner_id set not null;

-- add constraint if not exists в Postgres нет, поэтому повтор ловится как
-- duplicate_object — единственный способ оставить файл идемпотентным.
do $$ begin
  alter table studio.documents add constraint documents_id_owner unique (id, owner_id);
exception when duplicate_object then null; end $$;

-- Владелец фрагмента обязан совпадать с владельцем документа — это проверяет
-- база, а не приложение. Ошибка в коде выборки не может выдать чужой фрагмент:
-- его просто некуда было бы записать.
do $$ begin
  alter table studio.chunks add constraint chunks_owner_fk
    foreign key (document_id, owner_id)
    references studio.documents (id, owner_id) on delete cascade;
exception when duplicate_object then null; end $$;

create index if not exists documents_owner on studio.documents (owner_id);
-- Составной индекс — для выборок владельца. Одиночный chunks_document он не
-- отменяет: тот обслуживает внешний ключ по document_id и заводится вместе с
-- таблицей выше.
create index if not exists chunks_owner_document on studio.chunks (owner_id, document_id);
create index if not exists threads_owner on studio.threads (owner_id, updated_at desc);
create index if not exists artifacts_owner on studio.artifacts (owner_id);
create index if not exists nodes_owner on studio.nodes (owner_id);

commit;
