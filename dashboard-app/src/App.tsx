import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  CalendarClock, CheckSquare, FileText, Folder, HandCoins, Home, LogOut, Menu, NotebookPen, Repeat, Search, Settings, Users, Wallet, X,
} from "lucide-react";
import { supabase } from "./lib/supabase.ts";
import { useRoute, type Route } from "./lib/route.ts";
import { Login } from "./components/Login.tsx";
import { QuickAddHost } from "./components/QuickAdd.tsx";
import { BudgetView } from "./modules/budget/BudgetView.tsx";
import { DeadlinePage } from "./modules/deadlines/DeadlinePage.tsx";
import { DeadlinesView } from "./modules/deadlines/DeadlinesView.tsx";
import { HabitsView } from "./modules/habits/HabitsView.tsx";
import { HomeView } from "./modules/home/HomeView.tsx";
import { LoansView } from "./modules/loans/LoansView.tsx";
import { MeetingPage } from "./modules/meetings/MeetingPage.tsx";
import { MeetingsView } from "./modules/meetings/MeetingsView.tsx";
import { NotePage } from "./modules/notes/NotePage.tsx";
import { NotesView } from "./modules/notes/NotesView.tsx";
import { PaperPage } from "./modules/papers/PaperPage.tsx";
import { PapersView } from "./modules/papers/PapersView.tsx";
import { PrintMeetings, PrintProject } from "./modules/print/PrintViews.tsx";
import { ProjectPage } from "./modules/projects/ProjectPage.tsx";
import { ProjectsView } from "./modules/projects/ProjectsView.tsx";
import { SearchPalette, SearchView } from "./modules/search/Search.tsx";
import { SettingsView } from "./modules/settings/SettingsView.tsx";
import { TasksView } from "./modules/tasks/TasksView.tsx";

// Navigation, grouped. Each id is the first part of the route (#/<id>/…).
const NAV: { group?: string; items: { id: string; label: string; icon: typeof Home }[] }[] = [
  { items: [{ id: "home", label: "Dashboard", icon: Home }] },
  {
    group: "Research",
    items: [
      { id: "projects", label: "Projects", icon: Folder },
      { id: "tasks", label: "Tasks", icon: CheckSquare },
      { id: "papers", label: "Papers", icon: FileText },
      { id: "notes", label: "Notes", icon: NotebookPen },
      { id: "meetings", label: "Meetings", icon: Users },
      { id: "deadlines", label: "Deadlines", icon: CalendarClock },
    ],
  },
  {
    group: "Personal",
    items: [
      { id: "budget", label: "Budget", icon: Wallet },
      { id: "loans", label: "Loans", icon: HandCoins },
      { id: "habits", label: "Habits", icon: Repeat },
    ],
  },
];

function Page({ route }: { route: Route }) {
  const [section, id] = route.path;
  switch (section) {
    case "projects": return id ? <ProjectPage id={id} route={route} /> : <ProjectsView route={route} />;
    case "tasks": return <TasksView route={route} />;
    case "papers": return id ? <PaperPage id={id} /> : <PapersView route={route} />;
    case "notes": return id ? <NotePage id={id} /> : <NotesView route={route} />;
    case "meetings": return id ? <MeetingPage id={id} /> : <MeetingsView route={route} />;
    case "deadlines": return id ? <DeadlinePage id={id} /> : <DeadlinesView route={route} />;
    case "budget": return <BudgetView route={route} />;
    case "loans": return <LoansView />;
    case "habits": return <HabitsView />;
    case "search": return <SearchView route={route} />;
    case "settings": return <SettingsView />;
    default: return <HomeView />;
  }
}

function Centered({ children }: { children: ReactNode }) {
  return <main className="login"><div className="card login-card">{children}</div></main>;
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const route = useRoute();

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  useEffect(() => {
    if (!supabase || !userId) return;
    setIsOwner(null);
    supabase.rpc("am_i_owner").then(({ data, error }) => setIsOwner(!error && data === true));
  }, [userId]);

  useEffect(() => setMenuOpen(false), [route]);

  if (!supabase) {
    return (
      <Centered>
        <h1>Not connected</h1>
        <p className="muted">Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to connect the dashboard to Supabase.</p>
      </Centered>
    );
  }
  if (!ready) return null;
  if (!session) return <Login />;
  if (isOwner === null) return null;
  if (!isOwner) {
    return (
      <Centered>
        <h1>No access</h1>
        <p className="muted">This account isn’t the workspace owner. If this is your account, register it as the owner in Supabase (see the setup steps in the README).</p>
        <button onClick={() => supabase!.auth.signOut()}>Sign out</button>
      </Centered>
    );
  }

  // Print views render on their own, without the app chrome.
  if (route.path[0] === "print") {
    if (route.path[1] === "meetings") return <PrintMeetings ids={(route.query.get("ids") ?? "").split(",").filter(Boolean)} />;
    if (route.path[1] === "project") return <PrintProject id={route.query.get("id") ?? ""} />;
  }

  const section = route.path[0];
  return (
    <div className="shell">
      <header className="topbar">
        <button className="icon" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <span className="brand">Workspace</span>
        <button className="icon" aria-label="Search" onClick={() => window.dispatchEvent(new Event("ws:search"))}><Search size={19} /></button>
      </header>
      <nav className={`sidebar ${menuOpen ? "open" : ""}`} aria-label="Main">
        <div className="brand">Justin’s workspace</div>
        <button className="search-trigger" onClick={() => window.dispatchEvent(new Event("ws:search"))}>
          <Search size={15} /> Search <kbd>⌘K</kbd>
        </button>
        {NAV.map((g, i) => (
          <div className="nav-group" key={i}>
            {g.group && <div className="nav-group-label">{g.group}</div>}
            {g.items.map((m) => {
              const Icon = m.icon;
              const active = m.id === section || (m.id === "home" && !NAV.some((x) => x.items.some((y) => y.id === section)) && !["search", "settings"].includes(section));
              return (
                <a key={m.id} href={`#/${m.id}`} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
                  <Icon size={16} className="nav-icon" aria-hidden />
                  {m.label}
                </a>
              );
            })}
          </div>
        ))}
        <div className="sidebar-foot">
          <a href="#/settings" className={section === "settings" ? "active" : ""}><Settings size={15} className="nav-icon" /> Settings</a>
          <a href="https://justinseby.github.io/">Public site ↗</a>
          <button className="link" onClick={() => supabase!.auth.signOut()}><LogOut size={14} /> Sign out</button>
        </div>
      </nav>
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
      <main className="content">
        <Page route={route} />
      </main>
      <QuickAddHost />
      <SearchPalette />
    </div>
  );
}
