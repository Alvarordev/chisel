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

## Despliegue manual en Dokploy

La aplicación se despliega como una Application usando el `Dockerfile` del repositorio. No necesita Docker Compose ni un workflow de GitHub para el despliegue inicial.

Configura la Application con estos valores:

- Repository: `Alvarordev/chisel`
- Branch: `main`
- Build type: `Dockerfile`
- Dockerfile: `Dockerfile`
- Docker context path: `.`
- Container port: `3000`
- Trigger type: `On Push` o despliegue manual desde Dokploy

Monta el volumen persistente en `/data` antes del primer despliegue. Usa una sola réplica porque SQLite mantiene estado local.

Variables de producción:

```env
DATA_DIR=/data
HOST=0.0.0.0
PORT=3000
NODE_ENV=production
AUTH_BASE_URL=https://tu-dominio
MCP_RESOURCE=https://tu-dominio/mcp
MCP_JWKS_URL=http://127.0.0.1:3000/api/auth/jwks
TRUSTED_ORIGINS=https://tu-dominio
ALLOWED_HOSTS=tu-dominio
ALLOWED_ORIGIN_HOSTS=tu-dominio
BETTER_AUTH_SECRET=un-secreto-permanente-de-al-menos-32-caracteres
```

Configura HTTPS para el dominio y apunta al puerto interno `3000`. MCP/OAuth requieren HTTPS en un host público; `MCP_RESOURCE=http://...` solo es válido para desarrollo local con `localhost` o una IP de loopback. `ALLOWED_HOSTS` y `ALLOWED_ORIGIN_HOSTS` llevan solo el host, sin protocolo ni `/` final.

`MCP_JWKS_URL` es una URL interna para que el contenedor valide sus propios tokens sin salir por el dominio público. En Dokploy debe mantenerse como `http://127.0.0.1:3000/api/auth/jwks`; no se muestra en el metadata OAuth público.

Después del primer despliegue, crea el usuario inicial desde la terminal de la Application:

```bash
AUTH_BOOTSTRAP_EMAIL=owner@example.com \
AUTH_BOOTSTRAP_PASSWORD='una-password-de-12-caracteres' \
AUTH_BOOTSTRAP_NAME='Owner' \
bun run auth:bootstrap
```

Verifica el despliegue con:

```bash
curl https://tu-dominio/health
```

La respuesta esperada contiene `"ok":true`. Comprueba también que `/app/login` carga y que el usuario sigue disponible después de un segundo despliegue.

## Seguridad de desarrollo

Configura siempre `BETTER_AUTH_SECRET`, `AUTH_BASE_URL` y `MCP_RESOURCE` con los valores públicos reales en producción. Usa HTTPS, conserva el volumen `/data` y despliega una sola réplica para no dividir el estado SQLite. En local se aplican validaciones de `Host` y `Origin` mediante el adaptador oficial de Hono.
