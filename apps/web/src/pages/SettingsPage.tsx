import { useEffect, useState } from "react";
import type { Profile } from "@chisel/contracts";
import { getProfile, signOut } from "../lib/api";
import { Icon } from "../components/Icon";
import { useShellContext } from "../components/AppShell";

export function SettingsPage() {
  const { session, onSignedOut } = useShellContext();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [copied, setCopied] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const mcpUrl = `${window.location.origin}/mcp`;

  useEffect(() => {
    getProfile().then(setProfile).catch(() => undefined);
  }, []);

  async function copyMcpUrl() {
    await navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      onSignedOut();
      setSigningOut(false);
    }
  }

  return (
    <div className="page-wrap settings-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Tu espacio</p>
          <h1>Configuración</h1>
          <p className="page-lede">Ajustes básicos para que Chisel se adapte a tu forma de trabajar.</p>
        </div>
        <div className="header-symbol"><Icon name="settings" size={24} /></div>
      </header>

      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-card-heading">
            <div className="avatar avatar-large">{session.user.name.slice(0, 1).toUpperCase()}</div>
            <div>
              <p className="eyebrow">Cuenta</p>
              <h2>{session.user.name}</h2>
              <p>{session.user.email}</p>
            </div>
          </div>
          <div className="settings-detail-list">
            <div><span>Zona horaria</span><strong>{profile?.timezone ?? "Cargando..."}</strong></div>
            <div><span>Inicio del día</span><strong>{profile?.dayStart ?? "Cargando..."}</strong></div>
            <div><span>Cierre del día</span><strong>{profile?.dayEnd ?? "Cargando..."}</strong></div>
          </div>
          <button className="secondary-button logout-button" disabled={signingOut} onClick={() => void handleSignOut()} type="button">
            <Icon name="logout" size={17} /> Cerrar sesión
          </button>
        </section>

        <section className="settings-card mcp-card">
          <div className="mcp-card-icon"><Icon name="spark" size={20} /></div>
          <p className="eyebrow">Conexión de agentes</p>
          <h2>Tu puerta a Chisel</h2>
          <p>Usa esta URL para conectar Claude, ChatGPT u otro cliente MCP compatible.</p>
          <div className="copy-field">
            <code>{mcpUrl}</code>
            <button className="secondary-button compact-button" onClick={() => void copyMcpUrl()} type="button">
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
          <div className="mcp-tip"><Icon name="sun" size={16} /><span>El agente puede leer tu contexto y proponer el siguiente día.</span></div>
        </section>
      </div>
    </div>
  );
}
