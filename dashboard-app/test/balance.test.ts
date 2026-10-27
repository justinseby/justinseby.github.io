import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, balancesByContact, loanStatus, remaining, rowsByPerson, sortCurrencies, summaryByCurrency, totalsByCurrency, type Contact, type Loan, type Payment } from "../src/modules/loans/balance.ts";

const anna: Contact = { id: "c1", name: "Anna", phone: null, email: null, notes: null };
const ben: Contact = { id: "c2", name: "Ben", phone: null, email: null, notes: null };

const loan = (id: string, contact_id: string, direction: "lent" | "borrowed", amount: number, currency = "SEK", due_on: string | null = null): Loan =>
  ({ id, contact_id, direction, amount, currency, issued_on: "2026-01-01", due_on, note: null });
const pay = (loan_id: string, amount: number): Payment => ({ id: `p-${loan_id}-${amount}`, loan_id, amount, paid_on: "2026-02-01", note: null });

test("remaining subtracts payments without float drift", () => {
  const l = loan("l1", "c1", "lent", 100.3);
  assert.equal(remaining(l, [pay("l1", 0.1), pay("l1", 0.2)]), 100);
});

test("overpayment counts as settled, not negative", () => {
  const l = loan("l1", "c1", "lent", 50);
  assert.equal(remaining(l, [pay("l1", 80)]), 0);
  assert.equal(loanStatus(l, [pay("l1", 80)], "2026-03-01"), "settled");
});

test("status is overdue only after the due date while money is outstanding", () => {
  const l = loan("l1", "c1", "lent", 50, "SEK", "2026-03-01");
  assert.equal(loanStatus(l, [], "2026-03-01"), "open");
  assert.equal(loanStatus(l, [], "2026-03-02"), "overdue");
});

test("totals are kept per currency and split by direction", () => {
  const loans = [loan("l1", "c1", "lent", 500), loan("l2", "c2", "borrowed", 200), loan("l3", "c1", "lent", 1000, "INR")];
  const t = totalsByCurrency(loans, [pay("l1", 100)]);
  assert.deepEqual(t.SEK, { owedToMe: 400, iOwe: 200, net: 200 });
  assert.deepEqual(t.INR, { owedToMe: 1000, iOwe: 0, net: 1000 });
});

test("per-person net nets lending against borrowing with the same person", () => {
  const loans = [loan("l1", "c1", "lent", 500), loan("l2", "c1", "borrowed", 300), loan("l3", "c2", "lent", 50)];
  const rows = balancesByContact([anna, ben], loans, [pay("l3", 50)], "2026-03-01");
  assert.deepEqual(rows.find((r) => r.contact.id === "c1")!.net, { SEK: 200 });
  assert.deepEqual(rows.find((r) => r.contact.id === "c2")!.net, {});
  assert.equal(rows[0].contact.id, "c1");
});

test("currency summary tracks what was paid back, including settled loans", () => {
  const loans = [loan("l1", "c1", "borrowed", 1000, "INR"), loan("l2", "c2", "borrowed", 500, "INR"), loan("l3", "c1", "lent", 40, "EUR")];
  const s = summaryByCurrency(loans, [pay("l1", 250), pay("l2", 500), pay("l2", 100)]);
  assert.deepEqual(s.INR.borrowed, { total: 1500, paid: 750, left: 750 });
  assert.deepEqual(s.INR.lent, { total: 0, paid: 0, left: 0 });
  assert.deepEqual(s.EUR.lent, { total: 40, paid: 0, left: 40 });
});

test("per-person rows split by currency and direction, open ones first", () => {
  const loans = [loan("l1", "c2", "borrowed", 100), loan("l2", "c1", "borrowed", 300, "INR"), loan("l3", "c1", "borrowed", 200, "INR"), loan("l4", "c1", "borrowed", 50, "EUR")];
  const rows = rowsByPerson([anna, ben], loans, [pay("l1", 100), pay("l2", 50)], "2026-03-01");
  assert.deepEqual(rows.map((r) => [r.contact.name, r.currency, r.left]), [["Anna", "EUR", 50], ["Anna", "INR", 450], ["Ben", "SEK", 0]]);
  assert.equal(rows[1].paid, 50);
  assert.equal(rows[1].open.length, 2);
  assert.equal(rows[2].open.length, 0);
});

test("a partial repayment fills the earliest due loan first and never overpays", () => {
  const a = { ...loan("a", "c1", "borrowed", 100), due_on: "2026-06-01" };
  const b = { ...loan("b", "c1", "borrowed", 300), due_on: "2026-04-01" };
  const c = loan("c", "c1", "borrowed", 50);
  assert.deepEqual(allocate([a, b, c], [pay("b", 250)], 120), [{ loan_id: "b", amount: 50 }, { loan_id: "a", amount: 70 }]);
  assert.deepEqual(allocate([a, b, c], [], 1000).map((p) => p.amount), [300, 100, 50]);
  assert.deepEqual(allocate([a], [], 0), []);
});

test("main currencies come first in the order given", () => {
  assert.deepEqual(sortCurrencies(["SEK", "USD", "INR", "EUR", "GBP"], ["INR", "EUR", "SEK"]), ["INR", "EUR", "SEK", "GBP", "USD"]);
});
