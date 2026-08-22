# Chisel Planner

Planificador personal con una interfaz principal de agentes mediante MCP.

## Estado

El primer corte implementa el andamio Bun/Hono, SQLite por usuario, migraciones, configuración, dominio de proyectos/tareas/hábitos/capacidad, endpoint de salud y un servidor MCP sin autenticación para validar el contrato de transporte. El usuario `DEV_USER_ID` es solo una facilidad local. La autenticación OAuth y la superficie web completa se incorporan en fases posteriores.

## Requisitos

- Bun 1.3+
- Docker opcional

## Desarrollo

```bash
bun install
cp .env.example .env
bun run dev
```

Verificación rápida:

```bash
curl http://127.0.0.1:3000/health
```

Para inspeccionar el servidor MCP cuando esté levantado:

```bash
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:3000/mcp --transport http --method server/discover
```

## Comandos

```bash
bun run typecheck
bun test
bun run build
bun run migrate:all
```

La información persistente vive en `DATA_DIR`: `system.db` y una base independiente por usuario en `users/`.

## Seguridad de desarrollo

El endpoint MCP inicial no autentica requests. No lo expongas a Internet ni cargues datos reales hasta integrar OAuth 2.1 y los guards REST. En local se aplican validaciones de `Host` y `Origin` mediante el adaptador oficial de Hono.
