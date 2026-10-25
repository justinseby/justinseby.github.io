-- Loans: people you lend to or borrow from, each loan, and repayments against it.
-- Run after 000_foundation.sql. Safe to re-run.
-- contacts is also the shared people list (meeting participants).

create table if not exists public.contacts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  phone      text,
  email      text,
  notes      text,
  created_at timestamptz not null default now()
);
alter table public.contacts add column if not exists affiliation text;

create table if not exists public.loans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  direction  text not null check (direction in ('lent', 'borrowed')),
  amount     numeric(14, 2) not null check (amount > 0),
  currency   text not null default 'SEK' check (currency ~ '^[A-Z]{3}$'),
  issued_on  date not null default current_date,
  due_on     date,
  note       text,
  created_at timestamptz not null default now()
);

create table if not exists public.loan_payments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  loan_id    uuid not null references public.loans(id) on delete cascade,
  amount     numeric(14, 2) not null check (amount > 0),
  paid_on    date not null default current_date,
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists loans_user_contact_idx on public.loans (user_id, contact_id);
create index if not exists loan_payments_loan_idx on public.loan_payments (loan_id);

select private.secure_table('public.contacts');
select private.secure_table('public.loans');
select private.secure_table('public.loan_payments');

-- Policies from the first version of this file, replaced by owner_all above.
drop policy if exists contacts_owner on public.contacts;
drop policy if exists loans_owner on public.loans;
drop policy if exists loan_payments_owner on public.loan_payments;
