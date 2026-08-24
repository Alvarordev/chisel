import { useEffect, useState } from "react";
import type { AgentStyle, Profile } from "@chisel/contracts";
import { ApiError, getProfile, resetAccountData, signOut, updateProfile } from "../lib/api";
import { Icon } from "../components/Icon";
import { useShellContext } from "../components/AppShell";

const STYLE_OPTIONS: Array<{ value: AgentStyle; title: string; description: string }> = [
  {
    value: "direct",
    title: "Directo",
    description: "Pocas palabras, infiere y actúa. Ideal si querés planificar rápido.",
  },
  {
    value: "conversational",
    title: "Conversacional",
    description: "Negocia el plan y pide confirmación antes de persistir.",
  },
];

export function SettingsPage() {
  const { session, onSignedOut } = useShellContext();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [copied, setCopied] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [savingStyle, setSavingStyle] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState("");
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

  async function handleStyleChange(agentStyle: AgentStyle) {
    if (!profile || profile.agentStyle === agentStyle) return;
    setSavingStyle(true);
    try {
      setProfile(await updateProfile({ agentStyle }));
    } catch {
      // keep previous value
    } finally {
      setSavingStyle(false);
    }
  }

  function openResetDialog() {
    setResetConfirm("");
    setResetError("");
    setResetOpen(true);
  }

  function closeResetDialog() {
    if (resetting) return;
    setResetOpen(false);
    setResetConfirm("");
    setResetError("");
  }

  async function handleReset() {
    if (resetConfirm.trim().toUpperCase() !== "BORRAR") {
      setResetError('Escribí BORRAR para confirmar.');
      return;
    }
    setResetting(true);
    setResetError("");
    try {
      setProfile(await resetAccountData());
      setResetOpen(false);
      setResetConfirm("");
    } catch (caught) {
      setResetError(caught instanceof ApiError ? caught.message : "No pudimos borrar los datos.");
    } finally {
      setResetting(false);
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

        <section className="settings-card">
          <p className="eyebrow">Estilo del agente</p>
          <h2>Cómo habla contigo</h2>
          <p className="panel-lede">Afecta el contrato MCP que leen Claude, ChatGPT y otros clientes.</p>
          <div className="style-options" role="radiogroup" aria-label="Estilo del agente">
            {STYLE_OPTIONS.map((option) => {
              const selected = profile?.agentStyle === option.value;
              return (
                <button
                  aria-checked={selected}
                  className={`style-option${selected ? " is-selected" : ""}`}
                  disabled={savingStyle || !profile}
                  key={option.value}
                  onClick={() => void handleStyleChange(option.value)}
                  role="radio"
                  type="button"
                >
                  <strong>{option.title}</strong>
                  <span>{option.description}</span>
                </button>
              );
            })}
          </div>
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

        <section className="settings-card danger-card">
          <p className="eyebrow danger-eyebrow">Zona peligrosa</p>
          <h2>Borrar todos los datos</h2>
          <p className="panel-lede">
            Vuelve la app al estado inicial: proyectos, tareas, hábitos, horario y documentos.
            Tu cuenta de acceso se mantiene.
          </p>
          <button className="danger-button" onClick={openResetDialog} type="button">
            Borrar todo y volver al default
          </button>
        </section>
      </div>

      {resetOpen && (
        <div className="modal-backdrop" role="presentation" onClick={closeResetDialog}>
          <div
            aria-labelledby="reset-title"
            aria-modal="true"
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <p className="eyebrow danger-eyebrow">Confirmación</p>
            <h2 id="reset-title">¿Borrar todo?</h2>
            <p>
              Esta acción no se puede deshacer. Se eliminarán proyectos, tareas, hábitos, horario,
              documentos y archivos subidos. Escribí <strong>BORRAR</strong> para continuar.
            </p>
            <label>
              <span>Confirmación</span>
              <input
                autoFocus
                disabled={resetting}
                onChange={(event) => setResetConfirm(event.target.value)}
                placeholder="BORRAR"
                value={resetConfirm}
              />
            </label>
            {resetError && <div className="inline-error" role="alert">{resetError}</div>}
            <div className="modal-actions">
              <button className="secondary-button" disabled={resetting} onClick={closeResetDialog} type="button">
                Cancelar
              </button>
              <button
                className="danger-button"
                disabled={resetting || resetConfirm.trim().toUpperCase() !== "BORRAR"}
                onClick={() => void handleReset()}
                type="button"
              >
                {resetting ? "Borrando..." : "Borrar definitivamente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
