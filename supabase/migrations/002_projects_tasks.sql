-- Projects (the hub) and tasks, including recurring tasks. Run after 001. Safe to re-run.

create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title        text not null check (length(trim(title)) > 0),
  description  text,
  status       text not null default 'active'
               check (status in ('idea', 'planned', 'active', 'paused', 'completed', 'archived')),
  area         text not null default 'research'
               check (area in ('research', 'personal', 'teaching', 'administration', 'career', 'other')),
  start_date   date,
  target_date  date,
  completed_on date,
  tags         text[] not null default '{}',
  links        jsonb not null default '[]' check (jsonb_typeof(links) = 'array'),  -- [{label, url}]
  pinned       boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists projects_status_idx on public.projects (user_id, status);
create index if not exists projects_tags_idx on public.projects using gin (tags);
select private.secure_table('public.projects');
drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function private.touch_updated_at();

create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title        text not null check (length(trim(title)) > 0),
  description  text,
  status       text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'cancelled')),
  priority     text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  due_date     date,
  project_id   uuid references public.projects(id) on delete set null,
  tags         text[] not null default '{}',
  -- {"freq":"daily|weekly|monthly|yearly","interval":1,"weekdays":[1..7],"until":"YYYY-MM-DD"}
  recurrence   jsonb check (recurrence is null or recurrence->>'freq' in ('daily', 'weekly', 'monthly', 'yearly')),
  series_id    uuid,                                                  -- shared by all occurrences
  previous_id  uuid unique references public.tasks(id) on delete set null,  -- occurrence this one follows
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists tasks_open_due_idx on public.tasks (user_id, status, due_date);
create index if not exists tasks_project_idx on public.tasks (project_id);
create index if not exists tasks_tags_idx on public.tasks using gin (tags);
select private.secure_table('public.tasks');
drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function private.touch_updated_at();

-- ── Recurrence ──────────────────────────────────────────────────────────────

-- Next due date after `d` for a recurrence rule, or null when the rule has ended.
create or replace function public.next_occurrence(d date, rule jsonb)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  step     int := greatest(coalesce((rule->>'interval')::int, 1), 1);
  days     int[];
  candidate date;
  result   date;
begin
  case rule->>'freq'
    when 'daily' then result := d + step;
    when 'monthly' then result := (d + make_interval(months => step))::date;
    when 'yearly' then result := (d + make_interval(years => step))::date;
    when 'weekly' then
      select array_agg(x::int) into days from jsonb_array_elements_text(coalesce(rule->'weekdays', '[]')) x;
      if days is null then
        result := d + 7 * step;
      else
        -- first listed weekday after d, in a week that is a multiple of `step` weeks away
        for i in 1 .. 7 * step + 7 loop
          candidate := d + i;
          if extract(isodow from candidate)::int = any (days)
             and ((date_trunc('week', candidate)::date - date_trunc('week', d)::date) / 7) % step = 0 then
            result := candidate;
            exit;
          end if;
        end loop;
      end if;
    else
      return null;
  end case;
  if rule ? 'until' and result > (rule->>'until')::date then
    return null;
  end if;
  return result;
end
$$;

-- Stamp completion time, and give recurring tasks a series id.
create or replace function private.tasks_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.recurrence is not null and new.series_id is null then
    new.series_id := new.id;
  end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end
$$;
drop trigger if exists tasks_before_write on public.tasks;
create trigger tasks_before_write before insert or update on public.tasks
  for each row execute function private.tasks_before_write();

-- Completing a recurring task creates the next occurrence (once). The done task stays as history.
create or replace function private.tasks_spawn_next()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  next_due date;
begin
  if new.status = 'done' and old.status is distinct from 'done' and new.recurrence is not null
     and not exists (select 1 from public.tasks t where t.previous_id = new.id) then
    next_due := public.next_occurrence(coalesce(new.due_date, (new.completed_at at time zone 'Europe/Stockholm')::date), new.recurrence);
    if next_due is not null then
      insert into public.tasks (user_id, title, description, priority, due_date, project_id, tags,
                                recurrence, series_id, previous_id)
      values (new.user_id, new.title, new.description, new.priority, next_due, new.project_id, new.tags,
              new.recurrence, new.series_id, new.id);
    end if;
  end if;
  return null;
end
$$;
drop trigger if exists tasks_spawn_next on public.tasks;
create trigger tasks_spawn_next after update of status on public.tasks
  for each row execute function private.tasks_spawn_next();
