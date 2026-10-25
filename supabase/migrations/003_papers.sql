-- Papers library. A paper is stored once and linked to any number of projects. Run after 002.

create table if not exists public.papers (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title             text not null check (length(trim(title)) > 0),
  authors           text[] not null default '{}',
  year              int check (year between 1600 and 2200),
  publication       text,                -- journal, conference or preprint server
  abstract          text,
  doi               text check (doi is null or doi = lower(doi)),
  arxiv_id          text,
  pmid              text check (pmid is null or pmid ~ '^[0-9]+$'),
  url               text,
  status            text not null default 'to_read'
                    check (status in ('to_read', 'reading', 'read', 'to_cite', 'archived')),
  rating            int check (rating between 1 and 5),
  priority          text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  tags              text[] not null default '{}',
  -- structured reading notes
  summary           text,
  research_question text,
  methods           text,
  findings          text,
  strengths         text,
  limitations       text,
  relevance         text,
  ideas             text,
  page_refs         jsonb not null default '[]' check (jsonb_typeof(page_refs) = 'array'),  -- [{page, note}]
  started_on        date,
  finished_on       date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- The same paper cannot be added twice under the same identifier.
create unique index if not exists papers_doi_uq   on public.papers (user_id, doi)      where doi is not null;
create unique index if not exists papers_arxiv_uq on public.papers (user_id, arxiv_id) where arxiv_id is not null;
create unique index if not exists papers_pmid_uq  on public.papers (user_id, pmid)     where pmid is not null;
create index if not exists papers_status_idx on public.papers (user_id, status);
create index if not exists papers_tags_idx on public.papers using gin (tags);
select private.secure_table('public.papers');
drop trigger if exists papers_touch on public.papers;
create trigger papers_touch before update on public.papers
  for each row execute function private.touch_updated_at();

create table if not exists public.project_papers (
  project_id uuid not null references public.projects(id) on delete cascade,
  paper_id   uuid not null references public.papers(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (project_id, paper_id)
);
create index if not exists project_papers_paper_idx on public.project_papers (paper_id);
select private.secure_table('public.project_papers');
