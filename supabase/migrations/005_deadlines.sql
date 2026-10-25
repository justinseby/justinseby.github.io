-- Deadlines and milestones; tasks can be preparation for a deadline. Run after 004.

create table if not exists public.deadlines (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title        text not null check (length(trim(title)) > 0),
  description  text,
  category     text not null default 'other'
               check (category in ('conference', 'abstract_submission', 'paper_submission', 'course',
                                   'credits', 'isp', 'half_time_review', 'dissertation',
                                   'administration', 'personal', 'other')),
  due_date     date not null,
  due_time     time,                             -- optional, e.g. 23:59 AoE submissions
  status       text not null default 'upcoming'
               check (status in ('upcoming', 'in_progress', 'done', 'missed', 'cancelled')),
  priority     text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  project_id   uuid references public.projects(id) on delete set null,
  links        jsonb not null default '[]' check (jsonb_typeof(links) = 'array'),
  tags         text[] not null default '{}',
  notes        text not null default '',         -- markdown
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists deadlines_due_idx on public.deadlines (user_id, status, due_date);
create index if not exists deadlines_project_idx on public.deadlines (project_id);
create index if not exists deadlines_tags_idx on public.deadlines using gin (tags);
select private.secure_table('public.deadlines');
drop trigger if exists deadlines_touch on public.deadlines;
create trigger deadlines_touch before update on public.deadlines
  for each row execute function private.touch_updated_at();

-- Preparation tasks for a deadline.
alter table public.tasks add column if not exists deadline_id uuid references public.deadlines(id) on delete set null;
create index if not exists tasks_deadline_idx on public.tasks (deadline_id);
