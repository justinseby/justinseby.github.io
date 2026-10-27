// Pure loan arithmetic, kept free of React and Supabase so it can be unit tested.
// Money is handled in cents to avoid floating point drift.

export type Direction = "lent" | "borrowed";

export interface Contact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

export interface Loan {
  id: string;
  contact_id: string;
  direction: Direction;
  amount: number;
  currency: string;
  issued_on: string;
  due_on: string | null;
  note: string | null;
}

export interface Payment {
  id: string;
  loan_id: string;
  amount: number;
  paid_on: string;
  note: string | null;
}

export type LoanStatus = "open" | "overdue" | "settled";

const cents = (n: number) => Math.round(Number(n) * 100);

export function paidCents(loan: Loan, payments: Payment[]): number {
  return payments.filter((p) => p.loan_id === loan.id).reduce((sum, p) => sum + cents(p.amount), 0);
}

/** What is still outstanding on a loan, never below zero. */
export function remaining(loan: Loan, payments: Payment[]): number {
  return Math.max(0, cents(loan.amount) - paidCents(loan, payments)) / 100;
}

export function loanStatus(loan: Loan, payments: Payment[], today: string): LoanStatus {
  if (remaining(loan, payments) === 0) return "settled";
  if (loan.due_on && loan.due_on < today) return "overdue";
  return "open";
}

export interface CurrencyTotals {
  owedToMe: number;
  iOwe: number;
  net: number;
}

/** Outstanding totals per currency. Currencies are never mixed or converted. */
export function totalsByCurrency(loans: Loan[], payments: Payment[]): Record<string, CurrencyTotals> {
  const acc: Record<string, { owedToMe: number; iOwe: number }> = {};
  for (const loan of loans) {
    const left = cents(remaining(loan, payments));
    if (left === 0) continue;
    const t = (acc[loan.currency] ??= { owedToMe: 0, iOwe: 0 });
    if (loan.direction === "lent") t.owedToMe += left;
    else t.iOwe += left;
  }
  const out: Record<string, CurrencyTotals> = {};
  for (const [cur, t] of Object.entries(acc)) {
    out[cur] = { owedToMe: t.owedToMe / 100, iOwe: t.iOwe / 100, net: (t.owedToMe - t.iOwe) / 100 };
  }
  return out;
}

export interface ContactBalance {
  contact: Contact;
  /** Positive: they owe you. Negative: you owe them. Only non-zero currencies. */
  net: Record<string, number>;
  openLoans: number;
  overdueLoans: number;
}

export function balancesByContact(contacts: Contact[], loans: Loan[], payments: Payment[], today: string): ContactBalance[] {
  return contacts
    .map((contact) => {
      const mine = loans.filter((l) => l.contact_id === contact.id);
      const totals = totalsByCurrency(mine, payments);
      const net: Record<string, number> = {};
      for (const [cur, t] of Object.entries(totals)) if (t.net !== 0) net[cur] = t.net;
      const statuses = mine.map((l) => loanStatus(l, payments, today));
      return {
        contact,
        net,
        openLoans: statuses.filter((s) => s !== "settled").length,
        overdueLoans: statuses.filter((s) => s === "overdue").length,
      };
    })
    .sort((a, b) => b.openLoans - a.openLoans || a.contact.name.localeCompare(b.contact.name));
}

export interface Progress {
  /** Everything borrowed (or lent), including loans already settled. */
  total: number;
  paid: number;
  left: number;
}

const emptyProgress = (): Progress => ({ total: 0, paid: 0, left: 0 });

function addLoan(p: Progress, loan: Loan, payments: Payment[]) {
  const paid = Math.min(cents(loan.amount), paidCents(loan, payments));
  p.total += cents(loan.amount);
  p.paid += paid;
  p.left += cents(loan.amount) - paid;
}

const toUnits = (p: Progress): Progress => ({ total: p.total / 100, paid: p.paid / 100, left: p.left / 100 });

/** Most-used currencies first (the order of CURRENCIES), then the rest alphabetically. */
export function sortCurrencies(currencies: string[], preferred: string[]): string[] {
  const rank = (c: string) => (preferred.includes(c) ? preferred.indexOf(c) : preferred.length);
  return [...new Set(currencies)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export interface CurrencySummary {
  borrowed: Progress;
  lent: Progress;
}

/** Per currency: how much was borrowed and lent, how much of it is paid back, and what is left. */
export function summaryByCurrency(loans: Loan[], payments: Payment[]): Record<string, CurrencySummary> {
  const acc: Record<string, CurrencySummary> = {};
  for (const loan of loans) {
    const s = (acc[loan.currency] ??= { borrowed: emptyProgress(), lent: emptyProgress() });
    addLoan(s[loan.direction === "borrowed" ? "borrowed" : "lent"], loan, payments);
  }
  return Object.fromEntries(Object.entries(acc).map(([c, s]) => [c, { borrowed: toUnits(s.borrowed), lent: toUnits(s.lent) }]));
}

export interface PersonRow extends Progress {
  key: string;
  contact: Contact;
  direction: Direction;
  currency: string;
  /** Loans in this row that still have money outstanding, oldest first. */
  open: Loan[];
  overdue: number;
}

/** One row per person, direction and currency, with the rows that still have money left first. */
export function rowsByPerson(contacts: Contact[], loans: Loan[], payments: Payment[], today: string): PersonRow[] {
  const rows = new Map<string, PersonRow>();
  for (const loan of loans) {
    const contact = contacts.find((c) => c.id === loan.contact_id);
    if (!contact) continue;
    const key = `${loan.contact_id}|${loan.direction}|${loan.currency}`;
    let row = rows.get(key);
    if (!row) {
      row = { key, contact, direction: loan.direction, currency: loan.currency, ...emptyProgress(), open: [], overdue: 0 };
      rows.set(key, row);
    }
    addLoan(row, loan, payments);
    const status = loanStatus(loan, payments, today);
    if (status !== "settled") row.open.push(loan);
    if (status === "overdue") row.overdue += 1;
  }
  return [...rows.values()]
    .map((r) => ({ ...r, ...toUnits(r), open: oldestFirst(r.open) }))
    .sort((a, b) => Number(b.left > 0) - Number(a.left > 0) || a.contact.name.localeCompare(b.contact.name) || a.currency.localeCompare(b.currency));
}

function oldestFirst(loans: Loan[]): Loan[] {
  return [...loans].sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999") || a.issued_on.localeCompare(b.issued_on) || a.id.localeCompare(b.id));
}

/**
 * Splits one repayment across several loans, earliest due (then oldest) first,
 * never paying a loan more than what is left on it. Anything above the total left is dropped.
 */
export function allocate(loans: Loan[], payments: Payment[], amount: number): { loan_id: string; amount: number }[] {
  let rest = cents(amount);
  const out: { loan_id: string; amount: number }[] = [];
  for (const loan of oldestFirst(loans)) {
    if (rest <= 0) break;
    const take = Math.min(rest, cents(remaining(loan, payments)));
    if (take <= 0) continue;
    out.push({ loan_id: loan.id, amount: take / 100 });
    rest -= take;
  }
  return out;
}

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
}

export function todayISO(now = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
