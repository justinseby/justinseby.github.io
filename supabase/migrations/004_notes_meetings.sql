-- Notes (markdown) and meetings (free date/time, action items → tasks). Run after 003.

create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null default 'Untitled',
  body        text not null default '',          -- markdown
  type        text not null default 'general'
              check (type in ('research_idea', 'literature', 'daily_log', 'lab_notebook',
                              'meeting_prep', 'general', 'personal')),
  project_id  uuid references public.projects(id) on delete set null,
  paper_id    uuid references public.papers(id) on delete set null,
  tags        text[] not null default '{}',
  pinned      boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists notes_recent_idx on public.notes (user_id, updated_at desc);
create index if not exists notes_project_idx on public.notes (project_id);
create index if not exists notes_paper_idx on public.notes (paper_id);
create index if not exists notes_tags_idx on public.notes using gin (tags);
select private.secure_table('public.notes');
drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before update on public.notes
  for each row execute function private.touch_updated_at();

create table if not exists public.meetings (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title              text not null check (length(trim(title)) > 0),
  type               text not null default 'other'
                     check (type in ('supervisor', 'lab', 'research_discussion', 'collaboration',
                                     'administration', 'other')),
  starts_at          timestamptz not null,       -- chosen freely, no fixed schedule
  ends_at            timestamptz check (ends_at is null or ends_at >= starts_at),
  location           text,
  other_participants text,                       -- free text for people not in contacts
  agenda             text not null default '',   -- markdown sections, all optional
  discussion         text not null default '',
  decisions          text not null default '',
  next_steps         text not null default '',
  tags               text[] not null default '{}',
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists meetings_when_idx on public.meetings (user_id, starts_at);
create index if not exists meetings_type_idx on public.meetings (user_id, type);
select private.secure_table('public.meetings');
drop trigger if exists meetings_touch on public.meetings;
create trigger meetings_touch before update on public.meetings
  for each row execute function private.touch_updated_at();

create table if not exists public.meeting_projects (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  primary key (meeting_id, project_id)
);
create index if not exists meeting_projects_project_idx on public.meeting_projects (project_id);
select private.secure_table('public.meeting_projects');

create table if not exists public.meeting_participants (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  primary key (meeting_id, contact_id)
);
select private.secure_table('public.meeting_participants');

-- Tasks can come from a meeting.
alter table public.tasks add column if not exists meeting_id uuid references public.meetings(id) on delete set null;
create index if not exists tasks_meeting_idx on public.tasks (meeting_id);

create table if not exists public.meeting_action_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  text       text not null check (length(trim(text)) > 0),
  owner      text,                               -- who is responsible, free text
  done       boolean not null default false,
  task_id    uuid unique references public.tasks(id) on delete set null,
  position   int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists meeting_action_items_meeting_idx on public.meeting_action_items (meeting_id, position);
select private.secure_table('public.meeting_action_items');

-- Turn an action item into a task linked back to the meeting. Converting twice returns the same task.
create or replace function public.convert_action_item(item_id uuid, due date default null, project uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item     public.meeting_action_items;
  new_task uuid;
  proj     uuid := project;
begin
  select * into item from public.meeting_action_items where id = item_id for update;
  if not found then
    raise exception 'Action item not found';
  end if;
  if item.task_id is not null then
    return item.task_id;
  end if;
  if proj is null then
    select min(mp.project_id::text)::uuid into proj
    from public.meeting_projects mp where mp.meeting_id = item.meeting_id
    having count(*) = 1;
  end if;
  insert into public.tasks (title, due_date, project_id, meeting_id, status)
  values (item.text, due, proj, item.meeting_id, case when item.done then 'done' else 'todo' end)
  returning id into new_task;
  update public.meeting_action_items set task_id = new_task where id = item_id;
  return new_task;
end
$$;
revoke all on function public.convert_action_item(uuid, date, uuid) from public, anon;
grant execute on function public.convert_action_item(uuid, date, uuid) to authenticated;
