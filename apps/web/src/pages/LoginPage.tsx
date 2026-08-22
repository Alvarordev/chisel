import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, getSession, signIn, type AuthSession } from "../lib/api";
import { Icon } from "../components/Icon";

export function LoginPage({ onSignedIn }: { onSignedIn: (session: AuthSession) => void }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    try {
      await signIn(email, password);
      const session = await getSession();
      if (!session) throw new Error("No se pudo iniciar la sesión.");
      onSignedIn(session);
      navigate("/app/today", { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Revisa tus credenciales e inténtalo de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-story">
        <div className="brand-lockup login-brand">
          <div className="brand-mark"><Icon name="spark" size={19} /></div>
          <div>
            <strong>Chisel</strong>
            <span>Planner</span>
          </div>
        </div>
        <div className="login-story-copy">
          <p className="eyebrow">A plan with room to breathe</p>
          <h1>Haz menos ruido. Termina lo que importa.</h1>
          <p className="story-description">
            Chisel convierte tu capacidad real en un día que puedas cerrar con la cabeza en alto.
          </p>
        </div>
        <div className="story-footnote">
          <span className="story-dot" />
          <span>Tu contexto, tus proyectos, tu ritmo.</span>
        </div>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-card">
          <div className="login-card-heading">
            <p className="eyebrow">Bienvenido de vuelta</p>
            <h2 id="login-title">Entrar a tu espacio</h2>
            <p>Continúa donde lo dejaste.</p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <label>
              <span>Email</span>
              <input
                autoComplete="email"
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="tu@email.com"
                required
                type="email"
                value={email}
              />
            </label>
            <label>
              <span>Contraseña</span>
              <input
                autoComplete="current-password"
                name="password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Tu contraseña"
                required
                type="password"
                value={password}
              />
            </label>

            {error && <p className="form-error" role="alert">{error}</p>}

            <button className="primary-button wide-button" disabled={pending} type="submit">
              {pending ? "Entrando..." : "Entrar"}
              {!pending && <Icon name="arrow-up-right" size={17} />}
            </button>
          </form>

          <p className="login-note">Las cuentas se crean desde la instancia del propietario.</p>
        </div>
      </section>
    </main>
  );
}
