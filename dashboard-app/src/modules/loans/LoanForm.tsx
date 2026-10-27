import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../../lib/supabase.ts";
import { todayISO, type Contact, type Direction, type Loan } from "./balance.ts";
import { useSettings } from "../../lib/settings.ts";
import { CURRENCIES } from "../../lib/types.ts";
const NEW = "__new__";

/** New loan, or edits `loan` when given. */
export function LoanForm({ contacts, loan, defaultContactId, defaultDirection = "borrowed", onDone }: { contacts: Contact[]; loan?: Loan; defaultContactId?: string; defaultDirection?: Direction; onDone: () => void }) {
  const [contactId, setContactId] = useState(loan?.contact_id ?? defaultContactId ?? (contacts[0]?.id ?? NEW));
  const [newName, setNewName] = useState("");
  const [direction, setDirection] = useState<Direction>(loan?.direction ?? defaultDirection);
  const [amount, setAmount] = useState(loan ? String(loan.amount) : "");
  const settings = useSettings();
  const [currency, setCurrency] = useState(loan?.currency ?? settings.default_currency);
  useEffect(() => {
    if (!loan) setCurrency(settings.default_currency);
  }, [loan, settings.default_currency]);
  const [issuedOn, setIssuedOn] = useState(loan?.issued_on ?? todayISO());
  const [dueOn, setDueOn] = useState(loan?.due_on ?? "");
  const [note, setNote] = useState(loan?.note ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    let cid = contactId;
    if (cid === NEW) {
      const { data, error } = await supabase.from("contacts").insert({ name: newName.trim() }).select("id").single();
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
      cid = data.id;
    }
    const row = {
      contact_id: cid,
      direction,
      amount: Number(amount),
      currency,
      issued_on: issuedOn,
      due_on: dueOn || null,
      note: note.trim() || null,
    };
    const { error } = loan ? await supabase.from("loans").update(row).eq("id", loan.id) : await supabase.from("loans").insert(row);
    setBusy(false);
    if (error) setError(error.message);
    else onDone();
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="segmented" role="radiogroup" aria-label="Direction">
        <button type="button" role="radio" aria-checked={direction === "borrowed"} className={direction === "borrowed" ? "on" : ""} onClick={() => setDirection("borrowed")}>
          I borrowed money
        </button>
        <button type="button" role="radio" aria-checked={direction === "lent"} className={direction === "lent" ? "on" : ""} onClick={() => setDirection("lent")}>
          I lent money
        </button>
      </div>
      <label>
        {direction === "lent" ? "Lent to" : "Borrowed from"}
        <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value={NEW}>+ New person…</option>
        </select>
      </label>
      {contactId === NEW && (
        <label>
          Name
          <input required autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} />
        </label>
      )}
      <div className="row">
        <label className="grow">
          Amount
          <input required type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          Currency
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {[...new Set([currency, ...CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <div className="row">
        <label className="grow">
          Date
          <input required type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
        </label>
        <label className="grow">
          Due (optional)
          <input type="date" min={issuedOn} value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
        </label>
      </div>
      <label>
        Note (optional)
        <input value={note} placeholder="What it was for" onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? "Saving…" : loan ? "Save changes" : "Save loan"}</button>
    </form>
  );
}
