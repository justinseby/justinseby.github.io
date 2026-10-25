-- Habits: daily or on chosen weekdays. Archiving keeps all check-ins. Run after 006.

create table if not exists public.habits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  description text,
  frequency   text not null default 'daily' check (frequency in ('daily', 'weekdays')),
  weekdays    int[] not null default '{}' check (weekdays <@ array[1, 2, 3, 4, 5, 6, 7]),  -- ISO: 1 = Mon
  start_date  date not null default current_date,
  archived_at timestamptz,
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (frequency = 'daily' or cardinality(weekdays) > 0)
);
select private.secure_table('public.habits');
drop trigger if exists habits_touch on public.habits;
create trigger habits_touch before update on public.habits
  for each row execute function private.touch_updated_at();

create table if not exists public.habit_checkins (
  habit_id uuid not null references public.habits(id) on delete cascade,
  user_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day      date not null,
  primary key (habit_id, day)
);
create index if not exists habit_checkins_day_idx on public.habit_checkins (user_id, day);
select private.secure_table('public.habit_checkins');
