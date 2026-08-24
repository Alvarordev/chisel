import { NavLink, Outlet, useNavigate, useOutletContext } from "react-router-dom";
import { signOut, type AuthSession } from "../lib/api";
import { Icon, type IconName } from "./Icon";

type ShellLink = {
  to: string;
  label: string;
  icon: IconName;
};

const links: ShellLink[] = [
  { to: "/app/today", label: "Hoy", icon: "calendar" },
  { to: "/app/schedule", label: "Horario", icon: "clipboard" },
  { to: "/app/projects", label: "Proyectos", icon: "layers" },
  { to: "/app/settings", label: "Configuración", icon: "settings" },
];

export type ShellContext = {
  session: AuthSession;
  onSignedOut: () => void;
};

export function useShellContext(): ShellContext {
  return useOutletContext<ShellContext>();
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "C";
}

function Navigation({ mobile = false }: { mobile?: boolean }) {
  return (
    <nav className={mobile ? "mobile-nav" : "side-nav"} aria-label="Principal">
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          className={({ isActive }) => `nav-link${isActive ? " is-active" : ""}`}
        >
          <Icon name={link.icon} size={mobile ? 20 : 18} />
          <span>{link.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell({ session, onSignedOut }: ShellContext) {
  const navigate = useNavigate();
  const userInitials = initials(session.user.name);

  async function handleSignOut() {
    await signOut();
    onSignedOut();
    navigate("/app/login", { replace: true });
  }

  return (
    <div className="app-shell">
      <aside className="desktop-sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><Icon name="spark" size={18} /></div>
          <div>
            <strong>Chisel</strong>
            <span>Planner</span>
          </div>
        </div>

        <div className="sidebar-section-label">Workspace</div>
        <Navigation />

        <div className="sidebar-spacer" />
        <div className="sidebar-note">
          <Icon name="sun" size={17} />
          <p>Haz espacio para lo importante.</p>
        </div>
        <div className="sidebar-user">
          <div className="avatar avatar-small">{userInitials}</div>
          <div className="sidebar-user-copy">
            <strong>{session.user.name}</strong>
            <span>{session.user.email}</span>
          </div>
          <button className="icon-button subtle" type="button" onClick={handleSignOut} aria-label="Cerrar sesión">
            <Icon name="logout" size={16} />
          </button>
        </div>
      </aside>

      <div className="mobile-topbar">
        <div className="brand-lockup compact">
          <div className="brand-mark"><Icon name="spark" size={16} /></div>
          <strong>Chisel</strong>
        </div>
        <div className="avatar avatar-small">{userInitials}</div>
      </div>

      <main className="app-main">
        <Outlet context={{ session, onSignedOut }} />
      </main>

      <Navigation mobile />
    </div>
  );
}
