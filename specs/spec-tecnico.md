# Spec técnico — v1

**Proyecto:** Planificador con interfaz de agentes
**Documento padre:** `spec-mvp.md` v0.4
**Versión:** 1.1
**Fecha:** agosto 2026

---

## 1. Stack

| Capa | Elección | Nota |
|---|---|---|
| Runtime | Bun | `bun:sqlite` nativo, sin compilación de dependencias |
| HTTP | Hono | Un solo servidor para REST y MCP |
| MCP | `@modelcontextprotocol/server` + `@modelcontextprotocol/hono` | SDK oficial v2, Streamable HTTP MCP `2026-07-28` |
| Validación | Zod | Compartida entre schemas de tools y DTOs REST |
| DB | SQLite, una base por usuario | Sin contenedor adicional en el VPS |
| Acceso a datos | SQL a mano sobre `bun:sqlite` | Drizzle opcional; el dominio es chico |
| PDF → texto | `unpdf` | Sin dependencias nativas |
| DOCX → markdown | `mammoth` | |
| Frontend | Vite + React + Tailwind | Build estático servido por el mismo Hono |
| Deploy | Docker en Dokploy | Un servicio, un volumen |

**Presupuesto de recursos:** < 100 MB RSS en reposo. El VPS tiene ~1.8 GB disponibles con tres proyectos corriendo.

---

## 2. Estructura del proyecto

```
apps/
  api/
    src/
      core/                        ← toda la lógica de negocio
      projects/
      documents/
        ingest.ts                  ← pdf/docx → markdown
      capacity/
        resolve.ts                 ← plantilla + excepciones + inferencia
      tasks/
      habits/
      planning/
        propose.ts
        warnings.ts
        close-day.ts
      events/
      notes/
      shared.ts                    ← tipos y reglas comunes del dominio
      db/                           ← system.db, usuarios y migraciones
      api/                          ← cáscara REST
      mcp/                          ← cáscara MCP
      auth/                         ← Better Auth, actores y bootstrap
      index.ts                      ← bootstrap Hono
    tests/
  web/                             ← React/Vite/Tailwind responsive
packages/
  contracts/                       ← schemas y tipos HTTP compartidos
```

**Regla arquitectónica:** ni una decisión de negocio en `api/` ni en `mcp/`. Ambas traducen entrada, llaman a un service de `core/` y traducen salida. Un `ActorContext` (`{ userId, source, agentClient }`) se construye en el middleware y se pasa a los services; nunca se deduce dentro de `core/`.

El frontend web vive en `apps/web` y consume la API con sesiones Better Auth. `DEV_USER_ID` ya no participa en las rutas REST ni MCP; los actores se resuelven desde la sesión web o el bearer token OAuth.

---

## 3. Disco y volumen

Un único volumen montado en `/data`:

```
/data
  system.db                      ← usuarios, credenciales, OAuth
  users/
    {user_id}.db                 ← una base por usuario
  originals/
    {user_id}/
      {document_id}.pdf          ← binario original, solo para re-extracción
```

**Qué va dónde**

- **Markdown extraído → SQLite** (`documents.content`). Necesita transacciones, cascada al borrar el proyecto y consulta sin tocar el filesystem.
- **Binario original → disco.** Solo se lee si se re-extrae con un parser mejor. Nunca se sirve al agente.
- **`.db` → disco**, obviamente.

**Docker Compose (Dokploy)**

```yaml
services:
  planner:
    build: .
    volumes:
      - planner-data:/data
    environment:
      DATA_DIR: /data
volumes:
  planner-data:
```

Verificar que el volumen esté montado **antes** de cargar cualquier dato real. Un deploy con el volumen mal configurado borra todas las bases.

**Backup:** cron diario con `sqlite3 {file} ".backup {dest}"` sobre cada `.db`. `cp` a secas no es seguro con WAL activo.

---

## 4. Esquema

### 4.1 `system.db`

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  day_start     TEXT NOT NULL DEFAULT '07:00',
  day_end       TEXT NOT NULL DEFAULT '23:00',
  created_at    TEXT NOT NULL
);

CREATE TABLE oauth_clients (
  id            TEXT PRIMARY KEY,
  client_secret TEXT,
  redirect_uris TEXT NOT NULL,      -- JSON array
  name          TEXT NOT NULL,
  application_type TEXT NOT NULL DEFAULT 'web',
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  created_at    TEXT NOT NULL
);

CREATE TABLE oauth_authorization_codes (
  code                  TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id             TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  redirect_uri          TEXT NOT NULL,
  code_challenge        TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL CHECK (code_challenge_method = 'S256'),
  resource              TEXT NOT NULL,
  scope                 TEXT NOT NULL,
  expires_at            TEXT NOT NULL,
  used_at               TEXT,
  created_at            TEXT NOT NULL
);

CREATE TABLE oauth_tokens (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id   TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('access','refresh')),
  resource    TEXT NOT NULL,
  scope       TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE schema_versions (
  db_kind       TEXT NOT NULL,      -- 'system' | 'user'
  identifier    TEXT NOT NULL,      -- 'system' o user_id
  version       INTEGER NOT NULL,
  applied_at    TEXT NOT NULL,
  PRIMARY KEY (db_kind, identifier)
);
```

`schema_versions` vive en `system.db` para poder responder "¿qué bases están desactualizadas?" con una sola query. Cada base usa también `PRAGMA user_version` para que una caída entre la migración y el registro no vuelva a ejecutar una migración ya aplicada.

### 4.2 `users/{id}.db`

**Convenciones**

- Fechas y timestamps: TEXT en ISO-8601 UTC (`2026-08-22T14:30:00Z`). Ordena lexicográfica = cronológicamente.
- Fechas sin hora: TEXT `YYYY-MM-DD`.
- Horas: TEXT `HH:MM`.
- Booleanos: INTEGER 0/1.
- JSON: TEXT, consultable con `json_*` si hace falta.

```sql
-- ---------- proyectos ----------

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('build','study')),
  deadline    TEXT,
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active','archived')),
  created_at  TEXT NOT NULL
);

CREATE TABLE documents (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('spec','approach')),
  content       TEXT NOT NULL,              -- markdown, siempre
  summary       TEXT,                       -- para documentos largos
  source        TEXT NOT NULL CHECK (source IN ('upload','paste','agent')),
  original_name TEXT,
  original_path TEXT,                       -- relativo a /data/originals
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (project_id, type)
);

CREATE TABLE project_notes (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('agent','web')),
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_notes_project ON project_notes(project_id, created_at DESC);

-- ---------- capacidad ----------

CREATE TABLE capacity_blocks (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  day_of_week  INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time   TEXT NOT NULL,
  end_time     TEXT NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('busy','free','porous')),
  energy       TEXT CHECK (energy IN ('deep','shallow')),
  source       TEXT NOT NULL DEFAULT 'inferred'
               CHECK (source IN ('inferred','asked','learned','explicit')),
  valid_from   TEXT NOT NULL,
  valid_until  TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX idx_blocks_dow ON capacity_blocks(day_of_week, valid_from);

CREATE TABLE capacity_exceptions (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  block_id    TEXT REFERENCES capacity_blocks(id) ON DELETE CASCADE,
  action      TEXT NOT NULL CHECK (action IN ('cancel','replace','add')),
  label       TEXT,
  start_time  TEXT,
  end_time    TEXT,
  state       TEXT CHECK (state IN ('busy','free','porous')),
  energy      TEXT CHECK (energy IN ('deep','shallow')),
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_exceptions_date ON capacity_exceptions(date);

-- ---------- hábitos ----------

CREATE TABLE habits (
  id           TEXT PRIMARY KEY,
  action       TEXT NOT NULL,
  full_desc    TEXT NOT NULL,
  habit_floor  TEXT NOT NULL,
  full_minutes INTEGER NOT NULL CHECK (full_minutes > 0),
  floor_minutes INTEGER NOT NULL CHECK (floor_minutes > 0 AND floor_minutes <= full_minutes),
  schedule     TEXT NOT NULL,        -- JSON array de day_of_week
  block_hint   TEXT CHECK (block_hint IN ('morning','afternoon','evening')),
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','paused')),
  created_at   TEXT NOT NULL
);

-- ---------- tareas ----------

CREATE TABLE tasks (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('atomic','batch','habit')),
  action         TEXT NOT NULL,
  done_when      TEXT NOT NULL,
  weight         TEXT NOT NULL CHECK (weight IN ('S','M','L')),
  scheduled_for  TEXT NOT NULL,
  block          TEXT,                 -- bloque id o franja del día
  project_id     TEXT REFERENCES projects(id) ON DELETE CASCADE,
  habit_id       TEXT REFERENCES habits(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','done','dropped')),
  blocked_by     TEXT REFERENCES tasks(id),
  due_time       TEXT,
  completion_mode TEXT CHECK (completion_mode IN ('full','floor')),
  completed_at   TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX idx_tasks_day ON tasks(scheduled_for, status);
CREATE INDEX idx_tasks_project ON tasks(project_id, status);
CREATE UNIQUE INDEX idx_tasks_habit_occurrence
  ON tasks(habit_id, scheduled_for)
  WHERE habit_id IS NOT NULL;

CREATE TABLE batch_items (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  position    INTEGER NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT
);

CREATE INDEX idx_batch_task ON batch_items(task_id, position);

-- ---------- eventos ----------

CREATE TABLE task_events (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL,          -- sin FK: sobrevive al borrado
  event_type    TEXT NOT NULL CHECK (event_type IN
                ('created','completed','uncompleted','rescheduled',
                 'dropped','progress_updated')),
  occurred_at   TEXT NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('agent','web')),
  agent_client  TEXT CHECK (agent_client IN ('claude','chatgpt','gemini')),
  metadata      TEXT,                   -- JSON
  scheduled_for TEXT,                   -- denormalizado para análisis
  block         TEXT
);

CREATE INDEX idx_events_time ON task_events(occurred_at);
CREATE INDEX idx_events_task ON task_events(task_id);
```

**Nota sobre `task_events`:** sin FK a `tasks` a propósito. Si una tarea se borra, su historia debe sobrevivir — es el insumo de calibración. `scheduled_for` y `block` se denormalizan en el evento para poder calcular la distancia entre bloque planificado y hora real de completado sin join contra un registro que pudo cambiar.

**Nota sobre estimaciones:** la capacidad usa minutos. `S`, `M` y `L` se traducen a 15, 45 y 120 minutos y a 1, 2 y 4 puntos de progreso respectivamente. Los hábitos reservan `full_minutes` o `floor_minutes`, pero no suman puntos de proyecto. Las ocurrencias de hábito sin mutación no se insertan: `get_day` devuelve un id determinista y la primera mutación materializa la tarea.

---

## 5. Capa de datos

### 5.1 PRAGMAs

Se aplican **por conexión**, en la factory:

```ts
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;
  PRAGMA synchronous = NORMAL;
`)
```

`foreign_keys` viene apagado por defecto en SQLite. Sin él las FKs son decorativas.

### 5.2 Pool por usuario

```ts
// Map<userId, { db, lastUsed }>
// Eviction por inactividad: cerrar tras 30 min sin uso.
// getUserDb(userId): abre si no existe, aplica PRAGMAs, verifica versión de esquema.
```

Abrir y cerrar en cada request funciona pero pierde el page cache, que es justamente lo que hace rápido a SQLite.

### 5.3 Migraciones

Runner desde el día uno, aunque itere sobre un solo archivo. Retrofitearlo con datos reales adentro es mucho peor.

- Migraciones numeradas en `db/migrations/user/001_init.sql`, etc.
- Al abrir una base de usuario, comparar `PRAGMA user_version` contra las migraciones y registrar el resultado en `system.db.schema_versions`; aplicar cada migración en transacción.
- Comando `bun run migrate:all` que itera sobre `/data/users/*.db`, con reporte de fallos parciales y sin abortar el lote.

---

## 6. Ingesta de documentos

### 6.1 Pipeline

```
upload (multipart)
  → detectar tipo por magic bytes, no por extensión
  → extraer texto
  → validar resultado
  → guardar original en /data/originals/{user}/{doc_id}.{ext}
  → devolver markdown para preview (NO persiste todavía)

confirmar (usuario revisa/corrige el markdown en la web)
  → INSERT en documents
```

El paso de preview es importante: la extracción de PDF suele traer headers repetidos, la tabla de contenidos mezclada o saltos de columna mal resueltos. El usuario corrige antes de que el agente planifique sobre eso.

### 6.2 Extracción

```ts
// PDF
import { extractText, getDocumentProxy } from 'unpdf'
const pdf = await getDocumentProxy(new Uint8Array(buffer))
const { text } = await extractText(pdf, { mergePages: true })

// DOCX
import mammoth from 'mammoth'
const { value } = await mammoth.convertToMarkdown({ buffer })
```

### 6.3 Casos de fallo

| Caso | Detección | Respuesta |
|---|---|---|
| PDF escaneado | texto extraído < 100 chars con > 1 página | "Parece escaneado, no tiene capa de texto. Pegá el contenido a mano." |
| Formato no soportado | magic bytes | Lista de formatos aceptados |
| Archivo > 10 MB | tamaño | Rechazo con mensaje |
| Extracción vacía | idem escaneado | idem |

OCR queda **fuera de v1** sin excepción.

### 6.4 Summaries

El backend no tiene IA propia (no-objetivo del spec). El `summary` se llena por dos vías:

- `set_document` acepta un campo `summary` opcional → el agente lo genera al crear el documento por chat.
- La web ofrece un textarea de summary, opcional.

Regla: si `content` supera ~4.000 caracteres y no hay summary, `get_project_context` devuelve el content truncado con un aviso indicando que conviene generar un summary.

---

## 7. Servidor MCP

### 7.1 Montaje

Un endpoint `/mcp` sobre **Streamable HTTP** MCP `2026-07-28`, usando `createMcpHandler` y `@modelcontextprotocol/hono`. Cada intercambio es un `POST`; no se usan sesiones de protocolo, `Mcp-Session-Id`, `GET` standalone ni HTTP+SSE legado. Se configura respuesta JSON para el MVP; el SDK conserva soporte para respuestas SSE acotadas a un request.

```ts
// createMcpHandler(factory, { legacy: 'stateless', responseMode: 'json' })
// La factory registra tools/resources/prompts por request y no depende de
// estado de conexión. El actor se resuelve desde authInfo cuando OAuth exista.
```

Endpoints de discovery obligatorios, servidos por el mismo Hono:

- `/.well-known/oauth-authorization-server`
- `/.well-known/oauth-protected-resource`

Si estos no responden correctamente, el cliente no llega ni a la pantalla de login. Es el punto de fallo más común. Cada POST debe validar `MCP-Protocol-Version`, `Mcp-Method` y `Mcp-Name` cuando corresponda; el SDK oficial realiza esa validación del transporte.

### 7.2 Tools

**Planificación**

| Tool | Parámetros | Devuelve |
|---|---|---|
| `list_projects` | `status?` | id, nombre, kind, deadline, tareas pendientes |
| `get_project_context` | `project_id`, `max_length?` | `spec`, `approach`, `progress`, `notes` |
| `get_capacity` | `date` | bloques resueltos con `state`, `energy`, `source`, minutos efectivos y minutos libres |
| `get_day` | `date` | tareas del día por bloque, hábitos incluidos |
| `propose_tasks` | `project_id?`, `date`, `intent?`, `tasks[]` | valida el plan entregado por el agente, sin persistir; devuelve plan + warnings |
| `create_tasks` | `tasks[]`, `date` | ids creados + warnings |
| `complete_task` | `task_id`, `completion_mode?`, `item_ids?`, `note?` | estado actualizado |
| `reschedule` | `task_id`, `date`, `block?` | |
| `drop_task` | `task_id` | |
| `close_day` | `date` | puntos logrados, pendientes, opciones de reprogramación a 3 días |

**Configuración**

| Tool | Parámetros |
|---|---|
| `set_schedule` | `blocks[]`, `valid_from` |
| `create_exception` | `date`, `block_id?`, `action`, overrides |
| `set_block_attribute` | `block_id`, `state?`, `energy?` → promueve `source` |
| `create_project` | `name`, `kind`, `deadline?` |
| `set_document` | `project_id`, `type`, `content`, `summary?` |
| `create_habit` | `action`, `full_desc`, `habit_floor`, `full_minutes`, `floor_minutes`, `schedule[]`, `block_hint?` |
| `add_note` | `project_id`, `content` |

Todas con schema Zod. Las de solo lectura llevan `annotations: { readOnlyHint: true }`.

### 7.3 Resources

- `planning-contract` — el contrato del planificador (§7.4 del spec de producto).
- `project://{id}/spec`
- `project://{id}/approach`

### 7.4 Prompts

- `plan_today`
- `close_day`

Primitiva del protocolo, soportada por los tres clientes. No slash commands.

### 7.5 El contrato

Vive en `apps/api/src/mcp/contract.ts` como constante exportada, inyectada en:

- la `description` de `propose_tasks` y `create_tasks`
- el resource `planning-contract`

Es **la pieza de mayor riesgo del proyecto** y la única que se itera sin desplegar código nuevo si se sirve desde un archivo montado en el volumen. Considerar leerla de `/data/contract.md` con fallback al valor compilado.

---

## 8. API REST

Prefijo `/api`. Autenticación JWT.

```
POST   /api/auth/sign-in/email
POST   /api/auth/sign-out
GET    /api/auth/get-session

GET    /api/day/:date
POST   /api/tasks/:id/complete
POST   /api/tasks/:id/uncomplete
PATCH  /api/tasks/:id
POST   /api/batch-items/:id/toggle

GET    /api/projects
POST   /api/projects
GET    /api/projects/:id
POST   /api/projects/:id/documents/upload    ← multipart, devuelve preview
POST   /api/projects/:id/documents           ← confirma y persiste
POST   /api/projects/:id/notes

GET    /api/schedule
PUT    /api/schedule
POST   /api/schedule/exceptions

GET    /api/habits
POST   /api/habits
```

---

## 9. Autenticación

**Web:** Better Auth con sesión larga mediante cookie `HttpOnly`, `Secure` y `SameSite=Lax`. El frontend React vive en `apps/web` y la API resuelve el `ActorContext` desde la sesión.

**MCP:** OAuth 2.1 con PKCE. El servidor debe usar una librería probada para authorization server y validación de tokens; no se implementan criptografía, JWT ni validación de firmas manualmente.

Flujo mínimo requerido por los clientes:

1. Discovery vía `/.well-known/*`
2. CIMD queda preparado como evolución; el registro dinámico `/api/auth/oauth2/register` está activo como compatibilidad inicial.
3. `/oauth/authorize` con PKCE y `resource` → pantalla de login → redirect con code e issuer cuando corresponda
4. `/oauth/token` → access + refresh
5. Bearer token en cada POST a `/mcp`, validando expiración, scopes, issuer y audiencia/resource canónico

Ambos guards resuelven a un `userId` y construyen el `ActorContext`. De ahí para adentro, `core/` no sabe de dónde vino la petición.

---

## 10. Fases de implementación

Las fases son secuenciales por dependencia técnica, no por calendario.

**Fase 1 — Andamio**

1. Proyecto Bun + Hono, Dockerfile, volumen en `/data`.
2. Capa de datos: PRAGMAs, pool por usuario, migrator, `001_init.sql`.
3. `/health` y configuración validada.
4. Deploy vacío a Dokploy. **Verificar persistencia del volumen entre dos deploys antes de continuar.**

**Fase 2 — Dominio**

5. `core/projects`, `core/tasks`, `core/habits` con sus CRUD.
6. `core/capacity/resolve.ts` — plantilla + excepciones + inferencia en minutos. Es la pieza con más lógica; tests unitarios acá valen la pena.
7. `core/events` — inserción desde `ActorContext`.
8. Inyección determinista de hábitos en `get_day`, con ocurrencias virtuales idempotentes.

**Fase 3 — MCP**

9. Servidor MCP `2026-07-28` con `server/discover` y tools protegidos por OAuth 2.1. Verificar discovery, PKCE y bearer antes de ampliar la superficie.
10. Tools de escritura con schemas Zod, `outputSchema`/structured content donde corresponda y annotations.
11. Resources y prompts.
12. Contrato del planificador.
13. OAuth 2.1 **al final**. Debuggear protocolo y auth simultáneamente multiplica el tiempo de diagnóstico.

**Fase 4 — Superficie**

14. Ingesta de documentos: `unpdf`, `mammoth`, preview.
15. API REST autenticada.
16. Web: vista de día con done-log, marcar completo, upload de documentos.

**Fase 5 — Onboarding y validación**

17. Carga real: horario del ciclo, proyectos con sus documentos, hábitos.
18. `plan_today` desde Claude Code y Desktop.

**Fase 6 — Congelamiento**

Primera semana de uso real sin cambios de esquema. Solo iteración del contrato del planificador, que es texto servido desde el volumen. Revisión posterior contra los criterios de éxito del spec de producto.

## 11. Riesgos técnicos

| Riesgo | Mitigación |
|---|---|
| OAuth 2.1 consume tiempo desproporcionado | Dejarlo último; probar todo el protocolo sin auth primero |
| Volumen mal montado borra las bases | Verificar con dos deploys antes de cargar datos |
| Resolución de capacidad con bugs sutiles | Tests unitarios; es la única pieza que los amerita |
| El contrato del planificador resulta insuficiente | Servirlo desde el volumen para iterarlo sin deploy |
| Extracción de PDF sucia | Preview obligatorio antes de persistir |
| Alcance de la fase 4 | Si hay que recortar: web solo vista de día, onboarding por chat |
