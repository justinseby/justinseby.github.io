import type { ReactNode } from "react";
import { list, useLoad } from "../../lib/db.ts";
import { addDays, startOfMonth, today } from "../../lib/dates.ts";
import { href } from "../../lib/route.ts";
import { useSettings } from "../../lib/settings.ts";
import type { Deadline, HabitCheckin, Habit, Meeting, Note, Paper, Project, Task, Transaction } from "../../lib/types.ts";
import { openQuick, QUICK_ACTIONS } from "../../components/QuickAdd.tsx";
import { ErrorText } from "../../components/ui.tsx";
import { DeadlineRows, isOpenDeadline } from "../deadlines/DeadlineRows.tsx";
import { TodayHabits } from "../habits/HabitsView.tsx";
import { formatMoney, loanStatus, totalsByCurrency } from "../loans/balance.ts";
import { useLoans } from "../loans/useLoans.ts";
import { MeetingRows } from "../meetings/MeetingRows.tsx";
import { NoteRows } from "../notes/NoteRows.tsx";
import { PaperRows } from "../papers/PaperRows.tsx";
import { inView, sortTasks } from "../tasks/logic.ts";
import { TaskList } from "../tasks/TaskList.tsx";

function Card({ title, link, linkLabel = "View all", children }: { title: string; link: string; linkLabel?: string; children: ReactNode }) {
  return (
    <div className="card pad home-card">
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        <a className="small" href={link}>{linkLabel} →</a>
      </div>
      {children}
    </div>
  );
}

export function HomeView() {
  const now = today();
  const settings = useSettings();
  const { data, error } = useLoad(async () => {
    const [projects, tasks, deadlines, papers, notes, meetings, habits, checkins, txs] = await Promise.all([
      list<Project>("projects", { order: [["updated_at", false]] }),
      list<Task>("tasks", { in: ["status", ["todo", "in_progress"]] }),
      list<Deadline>("deadlines", { in: ["status", ["upcoming", "in_progress"]], order: [["due_date"]] }),
      list<Paper>("papers", { eq: { status: "reading" }, order: [["updated_at", false]], limit: 5 }),
      list<Note>("notes", { order: [["updated_at", false]], limit: 8 }),
      list<Meeting>("meetings", { gte: ["starts_at", new Date(Date.now() - 2 * 3600e3).toISOString()], order: [["starts_at"]], limit: 5 }),
      list<Habit>("habits"),
      list<HabitCheckin>("habit_checkins", { gte: ["day", addDays(now, -60)] }),
      list<Transaction>("transactions", { gte: ["occurred_on", startOfMonth(now)], eq: { kind: "expense" } }),
    ]);
    return { projects, tasks, deadlines, papers, notes: notes.filter((n) => !n.archived_at).slice(0, 5), meetings: meetings.filter((m) => !m.archived_at), habits, checkins, txs };
  }, []);
  const { loans, payments } = useLoans();

  const dateLabel = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const todays = data ? sortTasks(data.tasks.filter((t) => inView(t, "today", now) || inView(t, "overdue", now)), "all") : [];
  const deadlines = data?.deadlines.filter((d) => isOpenDeadline(d) && d.due_date <= addDays(now, 30)) ?? [];
  const active = data?.projects.filter((p) => p.status === "active").sort((a, b) => Number(b.pinned) - Number(a.pinned)).slice(0, 6) ?? [];
  const loanTotals = totalsByCurrency(loans, payments);
  const overdueLoans = loans.filter((l) => loanStatus(l, payments, now) === "overdue").length;
  const spent = (data?.txs ?? []).filter((t) => t.currency === settings.default_currency).reduce((s, t) => s + Math.round(Number(t.amount) * 100), 0) / 100;

  return (
    <section>
      <header className="page-head">
        <div className="page-head-text">
          <div className="kicker">{dateLabel}</div>
          <h1>{greeting}, Justin</h1>
        </div>
      </header>
      <ErrorText error={error} />

      <div className="quick-actions" aria-label="Quick actions">
        {QUICK_ACTIONS.map(({ kind, label, icon: Icon }) => (
          <button key={kind} onClick={() => openQuick(kind)}><Icon size={15} /> {label}</button>
        ))}
      </div>

      {data && (
        <div className="home-grid">
          <Card title={`Today${todays.length ? ` · ${todays.length}` : ""}`} link={href("tasks", { view: "today" })}>
            <TaskList tasks={todays} projects={data.projects} empty="Nothing due today. 🎉" />
          </Card>

          <Card title="Upcoming deadlines" link={href("deadlines")}>
            <DeadlineRows deadlines={deadlines.slice(0, 5)} empty="Nothing in the next 30 days." />
          </Card>

          <Card title="Upcoming meetings" link={href("meetings")}>
            <MeetingRows meetings={data.meetings} empty="No meetings scheduled." />
          </Card>

          <Card title="Habits today" link={href("habits")}>
            <TodayHabits habits={data.habits} checkins={data.checkins} />
          </Card>

          <Card title="Active projects" link={href("projects")}>
            {active.length === 0 ? <p className="muted small">No active projects.</p> : (
              <ul className="mini-list">
                {active.map((p) => {
                  const open = data.tasks.filter((t) => t.project_id === p.id).length;
                  return <li key={p.id}><a href={href(`projects/${p.id}`)}>{p.title}</a><span className="muted small">{open} open</span></li>;
                })}
              </ul>
            )}
          </Card>

          <Card title="Reading" link={href("papers", { status: "reading" })}>
            <PaperRows papers={data.papers} empty="No papers in progress." />
          </Card>

          <Card title="Recent notes" link={href("notes")}>
            <NoteRows notes={data.notes} empty="No notes yet." />
          </Card>

          <Card title="Money" link={href("budget")} linkLabel="Budget">
            <div className="stat-line"><span>Spent this month</span><strong>{formatMoney(spent, settings.default_currency)}</strong></div>
            {Object.entries(loanTotals).map(([cur, t]) => (
              <div className="stat-line" key={cur}><span>Loans net {cur}</span><strong className={t.net >= 0 ? "pos" : "neg"}>{formatMoney(t.net, cur)}</strong></div>
            ))}
            {overdueLoans > 0 && <a className="small neg" href={href("loans")}>{overdueLoans} overdue loan{overdueLoans > 1 ? "s" : ""} →</a>}
          </Card>
        </div>
      )}
    </section>
  );
}
