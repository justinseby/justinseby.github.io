-- Attachments (file metadata; the files themselves are in Storage) and global search. Run last.

create table if not exists public.attachments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  storage_path text not null unique,          -- <owner-uid>/<uuid>/<file name> in bucket workspace-files
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint check (size_bytes >= 0),
  project_id   uuid references public.projects(id) on delete cascade,
  paper_id     uuid references public.papers(id) on delete cascade,
  note_id      uuid references public.notes(id) on delete cascade,
  meeting_id   uuid references public.meetings(id) on delete cascade,
  deadline_id  uuid references public.deadlines(id) on delete cascade,
  created_at   timestamptz not null default now(),
  check (num_nonnulls(project_id, paper_id, note_id, meeting_id, deadline_id) = 1),
  check (split_part(storage_path, '/', 1) = user_id::text)
);
create index if not exists attachments_project_idx on public.attachments (project_id);
create index if not exists attachments_paper_idx on public.attachments (paper_id);
create index if not exists attachments_note_idx on public.attachments (note_id);
create index if not exists attachments_meeting_idx on public.attachments (meeting_id);
create index if not exists attachments_deadline_idx on public.attachments (deadline_id);
select private.secure_table('public.attachments');

-- Search across the main record types. Runs as the caller, so RLS limits it to the owner's rows.
create or replace function public.search_workspace(q text, max_results int default 30)
returns table (kind text, id uuid, title text, snippet text, project_id uuid, updated_at timestamptz, rank real)
language sql
stable
security invoker
set search_path = ''
as $$
  with query as (
    select websearch_to_tsquery('english', q) as tsq, '%' || q || '%' as pattern
  ),
  docs as (
    select 'project' as kind, p.id, p.title, coalesce(p.description, '') as body, p.id as project_id, p.updated_at, p.tags
    from public.projects p
    union all
    select 'task', t.id, t.title, coalesce(t.description, ''), t.project_id, t.updated_at, t.tags
    from public.tasks t
    union all
    select 'paper', pa.id, pa.title,
           concat_ws(' ', array_to_string(pa.authors, ', '), pa.publication, pa.abstract, pa.summary, pa.methods,
                     pa.findings, pa.relevance, pa.ideas, pa.doi, pa.arxiv_id, pa.pmid),
           null, pa.updated_at, pa.tags
    from public.papers pa
    union all
    select 'note', n.id, n.title, n.body, n.project_id, n.updated_at, n.tags
    from public.notes n where n.archived_at is null
    union all
    select 'meeting', m.id, m.title, concat_ws(' ', m.agenda, m.discussion, m.decisions, m.next_steps),
           null, m.updated_at, m.tags
    from public.meetings m
    union all
    select 'deadline', d.id, d.title, concat_ws(' ', d.description, d.notes), d.project_id, d.updated_at, d.tags
    from public.deadlines d
  ),
  scored as (
    select d.*,
           ts_rank(setweight(to_tsvector('english', d.title), 'A') || to_tsvector('english', d.body), query.tsq)
             + case when d.title ilike query.pattern then 1 else 0 end
             + case when exists (select 1 from unnest(d.tags) tag where tag ilike query.pattern) then 0.5 else 0 end
             as rank,
           query.tsq
    from docs d, query
    where (to_tsvector('english', d.title || ' ' || d.body) @@ query.tsq)
       or d.title ilike query.pattern
       or exists (select 1 from unnest(d.tags) tag where tag ilike query.pattern)
  )
  select s.kind, s.id, s.title,
         ts_headline('english', s.body, s.tsq, 'MaxWords=20, MinWords=8, MaxFragments=1'),
         s.project_id, s.updated_at, s.rank::real
  from scored s
  order by s.rank desc, s.updated_at desc
  limit greatest(least(max_results, 100), 1)
$$;
grant execute on function public.search_workspace(text, int) to authenticated;
revoke all on function public.search_workspace(text, int) from public, anon;

-- All tags in use, for autocomplete and filters.
create or replace function public.all_tags()
returns table (tag text, uses bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select tag, count(*) from (
    select unnest(tags) as tag from public.projects
    union all select unnest(tags) from public.tasks
    union all select unnest(tags) from public.papers
    union all select unnest(tags) from public.notes
    union all select unnest(tags) from public.meetings
    union all select unnest(tags) from public.deadlines
  ) t
  group by tag
  order by count(*) desc, tag
$$;
grant execute on function public.all_tags() to authenticated;
revoke all on function public.all_tags() from public, anon;
