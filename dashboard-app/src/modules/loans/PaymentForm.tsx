import { useState, type FormEvent } from "react";
import { supabase } from "../../lib/supabase.ts";
import { allocate, formatMoney, remaining, todayISO, type Loan, type Payment } from "./balance.ts";

const AUTO = "__auto__";
const cents = (n: number) => Math.round(n * 100);

/**
 * Records a repayment, full or partial. `loans` are the open loans with one person in one
 * currency; with several, the payment goes to the earliest due first unless one is picked.
 */
export function PaymentForm({ loans, payments, onDone }: { loans: Loan[]; payments: Payment[]; onDone: () => void }) {
  const [target, setTarget] = useState(loans.length > 1 ? AUTO : loans[0].id);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayISO());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const currency = loans[0].currency;
  const chosen = target === AUTO ? loans : loans.filter((l) => l.id === target);
  const left = chosen.reduce((s, l) => s + cents(remaining(l, payments)), 0) / 100;
  const value = Number(amount) || 0;
  const after = Math.max(0, cents(left) - cents(value)) / 100;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    const parts = allocate(chosen, payments, value);
    if (parts.length === 0) return setError("Enter an amount above zero.");
    setBusy(true);
    const { error } = await supabase.from("loan_payments").insert(parts.map((p) => ({ ...p, paid_on: paidOn, note: note.trim() || null })));
    setBusy(false);
    if (error) setError(error.message);
    else onDone();
  }

  return (
    <form className="form" onSubmit={submit}>
      {loans.length > 1 && (
        <label>
          Towards
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value={AUTO}>All open loans, earliest due first</option>
            {loans.map((l) => (
              <option key={l.id} value={l.id}>
                {l.note || `From ${l.issued_on}`} · {formatMoney(remaining(l, payments), currency)} left
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="muted" style={{ margin: 0 }}>Outstanding: <strong>{formatMoney(left, currency)}</strong></p>
      <label>
        Amount ({currency})
        <input required autoFocus type="number" inputMode="decimal" min="0.01" max={left} step="0.01" placeholder="How much did you pay this time?" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <div className="quick-amounts" aria-label="Quick amounts">
        {[10, 25, 50].map((pct) => (
          <button key={pct} type="button" onClick={() => setAmount(String(Math.round(left * pct) / 100))}>{pct}%</button>
        ))}
        <button type="button" onClick={() => setAmount(String(left))}>All of it</button>
      </div>
      <div className="row">
        <label className="grow">
          Date
          <input required type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </label>
        <label className="grow">
          Note (optional)
          <input value={note} placeholder="e.g. EMI 3 of 10, bank transfer" onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      {value > 0 && value <= left && (
        <p className="small" style={{ margin: 0 }}>
          {after === 0 ? <strong className="pos">This settles it.</strong> : <>After this, <strong>{formatMoney(after, currency)}</strong> is left.</>}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? "Saving…" : "Record payment"}</button>
    </form>
  );
}
