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

create extension if not exists vector;

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

-- 768 измерений — столько отдаёт gemini-embedding-001 с outputDimensionality 768.
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

-- Поиск по смыслу. Если pgvector старше 0.5 и hnsw недоступен, индекс можно не
-- создавать: запрос отработает последовательным чтением.
create index if not exists chunks_embedding on studio.chunks using hnsw (embedding vector_cosine_ops);

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
