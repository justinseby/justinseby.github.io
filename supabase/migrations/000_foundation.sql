-- Foundation: owner lock, the security helper every table uses, settings, private file storage.
-- Run first, once, in Supabase → SQL Editor. Safe to re-run.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ── Owner lock ──────────────────────────────────────────────────────────────
-- Exactly one account may use the workspace. After creating your login, run:
--   insert into private.app_owner (user_id)
--   select id from auth.users where email = 'you@example.com';

create table if not exists private.app_owner (
  singleton boolean primary key default true check (singleton),
  user_id   uuid not null unique references auth.users(id) on delete cascade
);
revoke all on private.app_owner from public, anon, authenticated;

create or replace function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.app_owner o where o.user_id = auth.uid())
$$;
revoke all on function private.is_owner() from public;
grant execute on function private.is_owner() to authenticated;

-- Lets the app tell a signed-in user whether they are the owner (no other information exposed).
create or replace function public.am_i_owner()
returns boolean
language sql
stable
set search_path = ''
as $$ select private.is_owner() $$;
revoke all on function public.am_i_owner() from public, anon;
grant execute on function public.am_i_owner() to authenticated;

-- ── secure_table: one place that locks a table down ──────────────────────────
-- Enables RLS, removes anonymous access, and allows only the owner to touch rows
-- they own. Every private table is passed through this.

create or replace function private.secure_table(t regclass)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('alter table %s enable row level security', t);
  execute format('revoke all on %s from anon, public', t);
  execute format('grant select, insert, update, delete on %s to authenticated', t);
  execute format('drop policy if exists owner_all on %s', t);
  execute format(
    'create policy owner_all on %s for all to authenticated
       using (user_id = (select auth.uid()) and (select private.is_owner()))
       with check (user_id = (select auth.uid()) and (select private.is_owner()))', t);
end
$$;
revoke all on function private.secure_table(regclass) from public, authenticated;

-- ── updated_at helper ───────────────────────────────────────────────────────

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- ── Settings ────────────────────────────────────────────────────────────────

create table if not exists public.settings (
  user_id          uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  default_currency text not null default 'SEK' check (default_currency ~ '^[A-Z]{3}$'),
  timezone         text not null default 'Europe/Stockholm',
  updated_at       timestamptz not null default now()
);
select private.secure_table('public.settings');

drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings
  for each row execute function private.touch_updated_at();

-- ── Private file storage ────────────────────────────────────────────────────
-- Files live at  workspace-files/<owner-user-id>/<anything>.  Max 50 MB each.

insert into storage.buckets (id, name, public, file_size_limit)
values ('workspace-files', 'workspace-files', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists workspace_files_owner on storage.objects;
create policy workspace_files_owner on storage.objects
  for all to authenticated
  using (
    bucket_id = 'workspace-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.is_owner())
  )
  with check (
    bucket_id = 'workspace-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.is_owner())
  );
