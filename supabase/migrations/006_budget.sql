-- Budget: categories, transactions (income / expense / transfer), monthly budgets. Run after 005.
-- Loans stay in their own tables (001) and are not mixed into budget totals.

create table if not exists public.budget_categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  kind        text not null default 'expense' check (kind in ('income', 'expense')),
  color       text,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, kind, name)
);
select private.secure_table('public.budget_categories');

create table if not exists public.transactions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind           text not null check (kind in ('income', 'expense', 'transfer')),
  description    text not null check (length(trim(description)) > 0),
  amount         numeric(14, 2) not null check (amount > 0),   -- always positive; kind gives direction
  currency       text not null default 'SEK' check (currency ~ '^[A-Z]{3}$'),
  category_id    uuid references public.budget_categories(id) on delete restrict,
  occurred_on    date not null default current_date,
  payment_method text,                                          -- e.g. card, Swish, cash, bank
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- transfers move money between your own accounts and have no category
  check (kind <> 'transfer' or category_id is null)
);
create index if not exists transactions_month_idx on public.transactions (user_id, occurred_on desc);
create index if not exists transactions_category_idx on public.transactions (category_id);
select private.secure_table('public.transactions');
drop trigger if exists transactions_touch on public.transactions;
create trigger transactions_touch before update on public.transactions
  for each row execute function private.touch_updated_at();

create table if not exists public.monthly_budgets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid not null references public.budget_categories(id) on delete cascade,
  month       date not null check (extract(day from month) = 1),  -- first day of the month
  amount      numeric(14, 2) not null check (amount >= 0),
  currency    text not null default 'SEK' check (currency ~ '^[A-Z]{3}$'),
  unique (category_id, month, currency)
);
select private.secure_table('public.monthly_budgets');

-- Budget vs actual per category for one month, per currency. Runs as the caller, so RLS applies.
create or replace function public.budget_month(month_start date)
returns table (category_id uuid, category text, kind text, currency text, budgeted numeric, actual numeric, remaining numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  with spend as (
    select t.category_id, t.currency, sum(t.amount) as actual
    from public.transactions t
    where t.kind <> 'transfer'
      and t.occurred_on >= month_start and t.occurred_on < (month_start + interval '1 month')::date
    group by 1, 2
  ),
  plan as (
    select b.category_id, b.currency, b.amount as budgeted
    from public.monthly_budgets b where b.month = month_start
  )
  select c.id, c.name, c.kind, coalesce(p.currency, s.currency),
         coalesce(p.budgeted, 0), coalesce(s.actual, 0), coalesce(p.budgeted, 0) - coalesce(s.actual, 0)
  from public.budget_categories c
  join (select category_id, currency from plan union select category_id, currency from spend) k on k.category_id = c.id
  left join plan p on p.category_id = k.category_id and p.currency = k.currency
  left join spend s on s.category_id = k.category_id and s.currency = k.currency
  order by c.kind, c.name
$$;
grant execute on function public.budget_month(date) to authenticated;
revoke all on function public.budget_month(date) from public, anon;
