import { Fragment, useMemo, useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import { supabase } from "../../lib/supabase.ts";
import { Modal } from "../../components/Modal.tsx";
import { PageHeader } from "../../components/ui.tsx";
import { formatMoney, loanStatus, paidCents, remaining, rowsByPerson, sortCurrencies, summaryByCurrency, todayISO, type Loan, type LoanStatus, type Progress } from "./balance.ts";
import { useLoans } from "./useLoans.ts";
import { LoanForm } from "./LoanForm.tsx";
import { PaymentForm } from "./PaymentForm.tsx";

type Filter = "active" | "overdue" | "settled" | "all";

// The currencies you use most, shown first in the totals.
const MAIN_CURRENCIES = ["INR", "EUR", "SEK"];
const LOG_PREVIEW = 12;

const pct = (p: Progress) => (p.total ? Math.round((100 * p.paid) / p.total) : 0);

export function LoansView() {
  const { contacts, loans, payments, loading, error, reload } = useLoans();
  const [filter, setFilter] = useState<Filter>("active");
  const [person, setPerson] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Loan | null>(null);
  const [paying, setPaying] = useState<Loan[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showSettledPeople, setShowSettledPeople] = useState(false);
  const [fullLog, setFullLog] = useState(false);
  const today = todayISO();

  const summary = useMemo(() => summaryByCurrency(loans, payments), [loans, payments]);
  const currencies = sortCurrencies(Object.keys(summary), MAIN_CURRENCIES);
  const people = useMemo(() => rowsByPerson(contacts, loans, payments, today), [contacts, loans, payments, today]);
  const visiblePeople = showSettledPeople ? people : people.filter((r) => r.left > 0);
  const nameOf = (id: string) => contacts.find((c) => c.id === id)?.name ?? "—";
  const loanOf = (id: string) => loans.find((l) => l.id === id);

  const rows = loans
    .map((loan) => ({ loan, status: loanStatus(loan, payments, today), left: remaining(loan, payments) }))
    .filter((r) => !person || r.loan.contact_id === person)
    .filter((r) => (filter === "all" ? true : filter === "active" ? r.status !== "settled" : r.status === filter));

  const log = payments
    .filter((p) => !person || loanOf(p.loan_id)?.contact_id === person)
    .sort((a, b) => b.paid_on.localeCompare(a.paid_on) || b.id.localeCompare(a.id));

  async function remove(table: "loans" | "loan_payments", id: string, what: string) {
    if (!supabase || !confirm(`Delete this ${what}? This cannot be undone.`)) return;
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) alert(error.message);
    await reload();
  }

  async function removePerson(id: string) {
    if (!supabase) return;
    if (loans.some((l) => l.contact_id === id)) return alert("Delete this person’s loans first.");
    if (!confirm("Remove this person?")) return;
    await supabase.from("contacts").delete().eq("id", id);
    setPerson(null);
    await reload();
  }

  const done = async () => {
    setAdding(false);
    setEditing(null);
    setPaying(null);
    await reload();
  };

  if (loading) return <p className="muted">Loading…</p>;

  return (
    <section>
      <PageHeader
        section="loans"
        title="Loans"
        subtitle="What you still owe, what’s owed to you, and every repayment along the way."
        actions={<button className="primary" onClick={() => setAdding(true)}>+ New loan</button>}
      />
      {error && <p className="error">{error}</p>}

      <div className="stats loan-stats">
        {currencies.length === 0 && <div className="card stat"><span className="muted">No loans yet.</span></div>}
        {currencies.map((cur) => {
          const { borrowed, lent } = summary[cur];
          const main = borrowed.total > 0 ? borrowed : lent;
          return (
            <div className="card stat loan-stat" key={cur}>
              <span className="stat-cur">{cur}</span>
              <span className="small muted">{main === borrowed ? "You still owe" : "Owed to you"}</span>
              <strong className={`stat-big ${main === borrowed ? (borrowed.left ? "neg" : "pos") : "pos"}`}>{formatMoney(main.left, cur)}</strong>
              <div className="bar" title={`${pct(main)}% paid back`}><span style={{ width: `${pct(main)}%` }} /></div>
              <span className="small muted">Paid back {formatMoney(main.paid, cur)} of {formatMoney(main.total, cur)} · {pct(main)}%</span>
              {main === borrowed && lent.total > 0 && (
                <div className="stat-line net"><span>Owed to you</span><strong className="pos">{formatMoney(lent.left, cur)}</strong></div>
              )}
            </div>
          );
        })}
      </div>

      <div className="card table-card loans-card">
        <div className="section-head">
          <h2 className="section-title">Remaining by person</h2>
          {people.some((r) => r.left === 0) && (
            <button className="link small" onClick={() => setShowSettledPeople(!showSettledPeople)}>{showSettledPeople ? "Hide settled" : "Show settled"}</button>
          )}
        </div>
        {visiblePeople.length === 0 ? (
          <p className="muted empty">{loans.length === 0 ? "Add a loan and each person shows up here with what’s left." : "Everything is paid back."}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Person</th><th className="num">Remaining</th><th className="progress-col">Paid back</th><th className="num">Total</th><th /></tr>
              </thead>
              <tbody>
                {visiblePeople.map((r) => (
                  <tr key={r.key} className={`clickable ${person === r.contact.id ? "selected" : ""} ${r.left === 0 ? "settled-row" : ""}`} onClick={() => setPerson(person === r.contact.id ? null : r.contact.id)}>
                    <td>
                      <strong>{r.contact.name}</strong>{" "}
                      <span className={`badge ${r.direction}`}>{r.direction === "borrowed" ? "You owe" : "Owes you"}</span>
                      {r.overdue > 0 && <span className="badge overdue">{r.overdue} overdue</span>}
                    </td>
                    <td className="num"><strong className={r.left === 0 ? "pos" : r.direction === "borrowed" ? "neg" : "pos"}>{r.left === 0 ? "Settled" : formatMoney(r.left, r.currency)}</strong></td>
                    <td className="progress-col">
                      <div className="progress-cell">
                        <div className="bar"><span style={{ width: `${pct(r)}%` }} /></div>
                        <span className="small muted">{formatMoney(r.paid, r.currency)} · {pct(r)}%</span>
                      </div>
                    </td>
                    <td className="num muted">{formatMoney(r.total, r.currency)}</td>
                    <td className="actions" onClick={(e) => e.stopPropagation()}>
                      {r.open.length > 0 && <button onClick={() => setPaying(r.open)}>{r.direction === "borrowed" ? "Pay back" : "Got paid"}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card table-card loans-card">
        <div className="section-head">
          <h2 className="section-title">Loans</h2>
          {person && (
            <span className="row small">
              <span className="filter-pill">{nameOf(person)} <button className="icon" aria-label="Show everyone" onClick={() => setPerson(null)}><X size={12} /></button></span>
              {!loans.some((l) => l.contact_id === person) && <button className="link danger small" onClick={() => removePerson(person)}>Remove this person</button>}
            </span>
          )}
        </div>
        <div className="tabs" role="tablist">
          {(["active", "overdue", "settled", "all"] as Filter[]).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="muted empty">{loans.length === 0 ? "No loans yet. Add your first one with “+ New loan”." : "Nothing here."}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Person</th><th>Type</th><th className="num">Amount</th><th className="num">Left</th><th>Due</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {rows.map(({ loan, status, left }) => {
                  const history = payments.filter((p) => p.loan_id === loan.id);
                  return (
                    <Fragment key={loan.id}>
                      <tr className="clickable" onClick={() => setExpanded(expanded === loan.id ? null : loan.id)}>
                        <td>{nameOf(loan.contact_id)}{loan.note && <div className="muted small">{loan.note}</div>}</td>
                        <td><span className={`badge ${loan.direction}`}>{loan.direction === "lent" ? "Lent" : "Borrowed"}</span></td>
                        <td className="num">{formatMoney(loan.amount, loan.currency)}</td>
                        <td className="num"><strong>{formatMoney(left, loan.currency)}</strong></td>
                        <td className="date">{loan.due_on ?? <span className="muted">—</span>}</td>
                        <td><StatusBadge status={status} /></td>
                        <td className="actions" onClick={(e) => e.stopPropagation()}>
                          {status !== "settled" && <button onClick={() => setPaying([loan])}>{loan.direction === "lent" ? "Got paid" : "Pay back"}</button>}
                        </td>
                      </tr>
                      {expanded === loan.id && (
                        <tr className="detail">
                          <td colSpan={7}>
                            <p className="small muted">{loan.direction === "lent" ? "Lent" : "Borrowed"} on {loan.issued_on}</p>
                            <p className="small"><strong>Repayments</strong> · paid {formatMoney(paidCents(loan, payments) / 100, loan.currency)} of {formatMoney(loan.amount, loan.currency)}</p>
                            {history.length === 0 && <p className="muted small">No repayments yet.</p>}
                            <ul className="history">
                              {history.map((p) => (
                                <li key={p.id}>
                                  <span>{p.paid_on}</span>
                                  <span>{formatMoney(p.amount, loan.currency)}</span>
                                  <span className="muted">{p.note}</span>
                                  <button className="link danger small" onClick={() => remove("loan_payments", p.id, "repayment")}>Delete</button>
                                </li>
                              ))}
                            </ul>
                            <span className="row">
                              <button className="link small" onClick={() => setEditing(loan)}><Pencil size={12} /> Edit loan</button>
                              <button className="link danger small" onClick={() => remove("loans", loan.id, "loan and its repayments")}>Delete loan</button>
                            </span>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card table-card loans-card">
        <div className="section-head">
          <h2 className="section-title">Repayment log{person && <span className="muted"> · {nameOf(person)}</span>}</h2>
          {log.length > LOG_PREVIEW && <button className="link small" onClick={() => setFullLog(!fullLog)}>{fullLog ? "Show recent" : `Show all ${log.length}`}</button>}
        </div>
        {log.length === 0 ? (
          <p className="muted empty">Every payment you record, full or partial, is listed here.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Date</th><th>Person</th><th className="num">Amount</th><th>Loan</th><th>Note</th><th /></tr>
              </thead>
              <tbody>
                {(fullLog ? log : log.slice(0, LOG_PREVIEW)).map((p) => {
                  const loan = loanOf(p.loan_id);
                  return (
                    <tr key={p.id}>
                      <td className="date">{p.paid_on}</td>
                      <td>
                        {loan ? nameOf(loan.contact_id) : "—"}{" "}
                        {loan && <span className="muted small">{loan.direction === "borrowed" ? "you paid" : "paid you"}</span>}
                      </td>
                      <td className="num"><strong>{loan ? formatMoney(p.amount, loan.currency) : p.amount}</strong></td>
                      <td className="muted small">{loan?.note || (loan && `From ${loan.issued_on}`)}</td>
                      <td className="muted small">{p.note}</td>
                      <td className="actions">
                        <button className="icon danger" aria-label="Delete repayment" onClick={() => remove("loan_payments", p.id, "repayment")}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {adding && (
        <Modal title="New loan" onClose={() => setAdding(false)}>
          <LoanForm contacts={contacts} defaultContactId={person ?? undefined} onDone={done} />
        </Modal>
      )}
      {editing && (
        <Modal title="Edit loan" onClose={() => setEditing(null)}>
          <LoanForm contacts={contacts} loan={editing} onDone={done} />
        </Modal>
      )}
      {paying && (
        <Modal title={`${paying[0].direction === "lent" ? "Repayment from" : "Repayment to"} ${nameOf(paying[0].contact_id)}`} onClose={() => setPaying(null)}>
          <PaymentForm loans={paying} payments={payments} onDone={done} />
        </Modal>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: LoanStatus }) {
  return <span className={`badge ${status}`}>{status === "open" ? "Open" : status === "overdue" ? "Overdue" : "Settled"}</span>;
}
