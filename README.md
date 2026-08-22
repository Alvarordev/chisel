# Chisel Planner

Planificador personal con una interfaz principal de agentes mediante MCP.

## Estado

El primer corte implementa el andamio Bun/Hono, SQLite por usuario, migraciones, configuración, dominio de proyectos/tareas/hábitos/capacidad, REST, una aproximación web responsive y un servidor MCP autenticado. OAuth 2.1 se resuelve con Better Auth: PKCE, DCR, login cerrado, sesiones web, JWT y tokens ligados al recurso MCP. La UI seguirá evolucionando desde Figma y CIMD queda para una fase posterior.

## Requisitos

- Bun 1.3+
- Docker opcional

## Desarrollo

```bash
bun install
cp .env.example .env
bun run dev
```

`bun run dev` levanta la API en `127.0.0.1:3000` y Vite en `127.0.0.1:5173`. La aplicación web vive en `/app/today` durante producción y usa un proxy a la API durante desarrollo.

Crear el primer usuario con el registro cerrado:

```bash
AUTH_BOOTSTRAP_EMAIL=owner@example.com \
AUTH_BOOTSTRAP_PASSWORD='una-password-de-12-caracteres' \
bun run auth:bootstrap
```

La primera aproximación web permite iniciar sesión, revisar el día, completar tareas y hábitos, crear proyectos y copiar la URL de conexión MCP. La vista está pensada mobile-first y se adapta a escritorio con sidebar.

Verificación rápida:

```bash
curl http://127.0.0.1:3000/health
```

El discovery OAuth está disponible en `/.well-known/oauth-authorization-server` y el metadata del recurso en `/.well-known/oauth-protected-resource/mcp`. `/mcp` requiere un access token con el scope `mcp:tools`.

Para inspeccionar el servidor MCP cuando esté levantado, usa un cliente que soporte el flujo OAuth 2.1:

```bash
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:3000/mcp --transport http --method server/discover
```

## Comandos

```bash
bun run typecheck
bun test
bun run build
bun run migrate:all
bun run auth:bootstrap
```

La información persistente vive en `DATA_DIR`: `system.db` y una base independiente por usuario en `users/`.

## Seguridad de desarrollo

Configura siempre `BETTER_AUTH_SECRET`, `AUTH_BASE_URL` y `MCP_RESOURCE` con los valores públicos reales en producción. Usa HTTPS, conserva el volumen `/data` y despliega una sola réplica para no dividir el estado SQLite. En local se aplican validaciones de `Host` y `Origin` mediante el adaptador oficial de Hono.
