import { formatMoney, loanStatus, todayISO, totalsByCurrency } from "../loans/balance.ts";
import { useLoans } from "../loans/useLoans.ts";

export function HomeView() {
  const { loans, payments, loading } = useLoans();
  const today = todayISO();
  const totals = totalsByCurrency(loans, payments);
  const overdue = loans.filter((l) => loanStatus(l, payments, today) === "overdue").length;
  const dateLabel = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <section>
      <header className="page-head">
        <div>
          <p className="muted">{dateLabel}</p>
          <h1>Hi Justin</h1>
        </div>
      </header>
      <div className="stats">
        <a className="card stat link-card" href="#/loans">
          <span className="stat-cur">Loans</span>
          {loading ? (
            <span className="muted">Loading…</span>
          ) : Object.keys(totals).length === 0 ? (
            <span className="muted">Nothing outstanding</span>
          ) : (
            Object.entries(totals).map(([cur, t]) => (
              <div className="stat-line" key={cur}>
                <span>Net {cur}</span>
                <strong className={t.net >= 0 ? "pos" : "neg"}>{formatMoney(t.net, cur)}</strong>
              </div>
            ))
          )}
          {overdue > 0 && <span className="badge overdue">{overdue} overdue</span>}
        </a>
      </div>
    </section>
  );
}
