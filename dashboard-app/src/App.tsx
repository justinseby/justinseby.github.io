import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase.ts";
import { useRoute } from "./lib/route.ts";
import { Login } from "./components/Login.tsx";
import { HomeView } from "./modules/home/HomeView.tsx";
import { LoansView } from "./modules/loans/LoansView.tsx";

// Each module is one entry here; new modules (papers, projects, to-dos) plug in the same way.
const MODULES = [
  { id: "home", label: "Home", icon: "⌂", View: HomeView },
  { id: "loans", label: "Loans", icon: "⇄", View: LoansView },
];

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
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

  if (!supabase) {
    return (
      <main className="login">
        <div className="card login-card">
          <h1>Not connected</h1>
          <p className="muted">Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to connect the dashboard to Supabase.</p>
        </div>
      </main>
    );
  }
  if (!ready) return null;
  if (!session) return <Login />;
  if (isOwner === null) return null;
  if (!isOwner) {
    return (
      <main className="login">
        <div className="card login-card">
          <h1>No access</h1>
          <p className="muted">
            This account isn’t the workspace owner. If this is your account, register it as the owner in Supabase
            (see the setup steps in the README).
          </p>
          <button onClick={() => supabase!.auth.signOut()}>Sign out</button>
        </div>
      </main>
    );
  }

  const current = MODULES.find((m) => m.id === route) ?? MODULES[0];
  const View = current.View;

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">Justin’s workspace</div>
        {MODULES.map((m) => (
          <a key={m.id} href={`#/${m.id}`} className={m.id === current.id ? "active" : ""}>
            <span className="nav-icon" aria-hidden>{m.icon}</span>
            {m.label}
          </a>
        ))}
        <div className="sidebar-foot">
          <a href="https://justinseby.github.io/">Public site ↗</a>
          <button className="link" onClick={() => supabase!.auth.signOut()}>Sign out</button>
        </div>
      </nav>
      <main className="content">
        <View />
      </main>
    </div>
  );
}
