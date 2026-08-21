-- Private schema for privileged helpers. It is not exposed through the Data API,
-- so security definer code here is not reachable as a PostgREST endpoint.
create schema if not exists private;
revoke all on schema private from anon, authenticated;

-- One profile row per auth.users record. auth.users itself is not readable by
-- the Data API, so this is the table the app reads a signed-in user's name from.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Public profile for each authenticated Lura user; kept in sync with auth.users by trigger.';

alter table public.profiles enable row level security;

-- Read and update are limited to the row the caller owns. There is deliberately
-- no insert or delete policy: rows are created by the signup trigger below and
-- removed by the cascade when the auth user is deleted.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

grant select, update on public.profiles to authenticated;

-- Keeps updated_at honest regardless of what the client sends.
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();

-- Mirrors a new auth user into public.profiles. full_name comes from the
-- signup metadata the register form sends. Security definer because the signup
-- happens as the auth service role, which has no rights on public.profiles.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name);
  return new;
end;
$$;

revoke all on function private.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- An email change in auth.users must not leave a stale address on the profile.
create or replace function private.sync_auth_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
    set email = new.email
    where id = new.id and public.profiles.email is distinct from new.email;
  return new;
end;
$$;

revoke all on function private.sync_auth_user_email() from public, anon, authenticated;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function private.sync_auth_user_email();
