import { useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Icon } from "./components/Icon";
import { LoginPage } from "./pages/LoginPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TodayPage } from "./pages/TodayPage";
import { getSession, type AuthSession } from "./lib/api";

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <div className="brand-mark large"><Icon name="spark" size={24} /></div>
      <p>Preparando tu espacio...</p>
    </main>
  );
}

function SessionError({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="loading-screen">
      <div className="empty-icon"><span>!</span></div>
      <h1>No pudimos conectar</h1>
      <p>Comprueba que la API está funcionando e inténtalo de nuevo.</p>
      <button className="primary-button" onClick={onRetry} type="button">Reintentar</button>
    </main>
  );
}

function ProtectedRoute({ session }: { session: AuthSession | null }) {
  if (!session) return <Navigate replace to="/app/login" />;
  return <Outlet />;
}

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [sessionState, setSessionState] = useState<"loading" | "ready" | "error">("loading");

  async function loadSession() {
    setSessionState("loading");
    try {
      setSession(await getSession());
      setSessionState("ready");
    } catch {
      setSessionState("error");
    }
  }

  useEffect(() => {
    void loadSession();
  }, []);

  if (sessionState === "loading") return <LoadingScreen />;
  if (sessionState === "error") return <SessionError onRetry={() => void loadSession()} />;

  const defaultPath = session ? "/app/today" : "/app/login";

  return (
    <Routes>
      <Route path="/app/login" element={session ? <Navigate replace to="/app/today" /> : <LoginPage onSignedIn={setSession} />} />
      <Route element={<ProtectedRoute session={session} />}>
        <Route element={<AppShell onSignedOut={() => setSession(null)} session={session!} />}>
          <Route path="/app/today" element={<TodayPage />} />
          <Route path="/app/projects" element={<ProjectsPage />} />
          <Route path="/app/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="/" element={<Navigate replace to={defaultPath} />} />
      <Route path="*" element={<Navigate replace to={defaultPath} />} />
    </Routes>
  );
}
