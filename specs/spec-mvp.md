# Spec — Planificador con interfaz de agentes

**Versión:** 0.4 (MVP)
**Fecha:** agosto 2026
**Autor:** Alvaro

---

## 1. Problema

Las tareas ambiguas no se ejecutan. "Avanzar la página" no es accionable; "crear la clase `Prestamo` con sus atributos" sí lo es. El costo de descomponer trabajo ambiguo en acciones concretas es alto, se paga todos los días, y es exactamente lo que un LLM hace bien.

El obstáculo es que los agentes de IA no tienen ni el contexto del proyecto ni el estado de lo ya avanzado. Se los hay que repetir en cada conversación.

## 2. Propuesta

Una aplicación de tareas cuya **interfaz principal de escritura son los agentes de IA** del usuario (Claude, ChatGPT, Gemini), conectados vía MCP. La app almacena el contexto de los proyectos, la capacidad real del día y el registro de progreso. El agente lee todo eso y propone el plan del día.

Las superficies web y móvil sirven para **configurar, consumir y marcar**: cargar proyectos y horarios, ver el día, tachar. La planificación diaria ocurre en el agente.

## 3. Principios de diseño

Derivados de la evidencia sobre procrastinación y formación de hábitos:

1. **El sistema nunca rechaza.** Informa y registra. La decisión es del usuario, siempre.
2. **Nada punitivo.** Sin rachas rotas, sin acumulación en rojo, sin notificaciones por incumplimiento. La procrastinación es regulación emocional: la culpa la aumenta.
3. **Toda tarea es verificable.** Si no se puede escribir un criterio de terminado, la tarea está mal descompuesta.
4. **El progreso se muestra.** Ver avance concreto es el principal sostén de la motivación diaria.
5. **Consistencia sobre intensidad.** Un hábito reducido cuenta como cumplido.
6. **Los datos calibran el sistema, no juzgan al usuario.** Toda señal de comportamiento se usa para mejorar la planificación, nunca para mostrarle al usuario su propio expediente.
7. **Configurar cuesta, inferir es gratis.** El usuario declara solo lo que ya sabe de memoria. Todo lo demás lo asume el sistema y lo corrige con uso. Nadie microgestiona su propia agenda.

## 4. No-objetivos

- No es un gestor de proyectos de equipo. Un solo usuario, sin colaboración.
- No es un calendario. No reemplaza a Google Calendar.
- No genera la solución técnica del trabajo, solo el siguiente paso.
- No tiene IA propia. El usuario trae la suya.

---

## 5. Alcance del MVP

### 5.1 Dentro

| Área | Alcance |
|---|---|
| Cuenta | Registro y login. Un usuario, varios clientes MCP. La cuenta declara zona horaria y ventana diaria. |
| Auth MCP | OAuth 2.1 según spec de MCP (requerido por ChatGPT). |
| Onboarding | Alta manual de horario, proyectos, documentos y hábitos. Web y agente. |
| Proyectos | CRUD. Tipos: `build`, `study`. |
| Documentos | `spec` y `approach` en markdown. |
| Tareas | Atómicas, batch con progreso parcial, hábitos. |
| Día | Ver el día, marcar completo, reprogramar, borrar. |
| Capacidad | Plantilla semanal con vigencia + excepciones por fecha + inferencia. Se calcula en minutos. |
| Hábitos | CRUD e inyección determinista por el backend. |
| Planificación | `propose` (efímero) y `create` (persiste). |
| Rituales | Prompts MCP `plan_today` y `close_day`. |
| Avisos | En la respuesta del tool, nunca como bloqueo. |
| Progreso | Derivado de tareas completadas, no escrito a mano. |
| Eventos | `task_events` append-only para calibración. |
| Web | Responsive, usable en móvil. |

### 5.2 Fuera de v1, con justificación

**Notificaciones push.** Requiere scheduler persistente + FCM + APNs + Web Push. Es un subsistema completo y convierte el backend de CRUD a servicio con estado temporal. Las tareas con hora límite existen en v1, sin alerta. *v2.*

**App móvil nativa.** La web responsive cubre el caso de uso real. *Se evalúa cuando el uso diario esté probado.*

**Integración con Google Calendar.** El horario es recurrente y cambia una vez por ciclo. *v2.*

**Integración con Git.** El progreso se deriva de las tareas tachadas. *Sin fecha.*

**Calibración `learned` de bloques.** Requiere semanas de `task_events`. La infraestructura queda lista desde v1 (§6.4). *v2.*

**Anclas de evento con lead time automático.** Sin push, el valor es marginal. En v1 se resuelve con hora límite en una tarea atómica. *v2.*

**Reparto automático de estudio.** El tipo `study` existe; el reparto lo hace el agente por prompt, no el backend. *No requiere código en v1.*

---

## 6. Modelo de datos (conceptual)

### 6.1 Tarea

Una sola entidad con discriminador `kind`.

| Campo | Descripción |
|---|---|
| `action` | Acción concreta y ejecutable. |
| `done_when` | Criterio de terminado verificable. Obligatorio. |
| `weight` | `S` (~15 min) · `M` (~45 min) · `L` (~2h). |
| `scheduled_for` | Fecha. |
| `block` | Referencia al bloque, o franja del día. |
| `project_id` | Nullable. |
| `status` | `pending` · `done` · `dropped`. |
| `blocked_by` | Nullable, otra tarea. |
| `due_time` | Nullable, hora límite. |

**Por tipo**

- `atomic` — nada adicional.
- `batch` — `items[]` con estado individual. Peso estimado como *primer ítem completo + resto al 30%*, no lineal.
- `habit` — ver 6.2.

### 6.2 Hábitos

| Campo | Descripción |
|---|---|
| `schedule` | Días de la semana. |
| `full` | Definición completa. |
| `habit_floor` | Acción mínima aceptable, en texto. |
| `full_minutes` | Minutos reservados cuando se planifica el hábito completo. |
| `floor_minutes` | Minutos reservados cuando se degrada al mínimo. Puede ser 5 o 10. |
| `completion_mode` | `full` · `floor` · `null`, al completar. |

Reglas:

- **El backend los inyecta de forma determinista** en `get_day`. El agente no los propone ni los calcula.
- El agente los ve como **capacidad ya ocupada** y planifica proyectos en el espacio restante.
- Ante sobrecarga, se degradan a `habit_floor`. **Nunca se eliminan del día.**
- No generan puntos de proyecto, pero sus minutos sí se descuentan de la capacidad física del día.
- Completar en modo `floor` cuenta como cumplido. No es fracaso ni se muestra como tal.

Una ocurrencia se representa como un identificador determinista `habit:{habit_id}:{date}` y permanece virtual hasta que el usuario la completa, la modifica o el backend necesita registrar un estado. Esto evita crear filas por adelantado y hace la inyección idempotente.

### 6.3 Proyecto

`name`, `kind` (`build` | `study`), `deadline` (nullable), `status`.

Documentos asociados, cargados manualmente por el usuario:

- **`spec`** — lo que se pide. El PDF de la universidad, el requerimiento del cliente.
- **`approach`** — cómo se va a hacer. Stack, capas, convenciones. Incluye una sección de **scripted actions**: contingencias en formato *"si me bloqueo con X, hago Y"*. El agente las usa cuando una tarea acumula reprogramaciones.

`progress` es **derivado** de las tareas completadas, nunca almacenado ni editado a mano.

### 6.4 Capacidad

Se resuelve en dos capas más una de inferencia. El usuario solo toca la primera.

**Capa 1 — Plantilla semanal**

```
capacity_blocks
  label            "Progra Web", "Judo"
  day_of_week      1..7
  start_time, end_time
  state            busy | free | porous
  energy           deep | shallow | null
  source           explicit | asked | inferred | learned
  valid_from, valid_until
```

La **vigencia** es obligatoria: el horario cambia cada ciclo académico. Filas nuevas por ciclo en vez de edición destructiva, para que los `task_events` históricos sigan siendo interpretables.

**Capa 2 — Excepciones por fecha**

```
capacity_exceptions
  date
  block_id      | null    ← null afecta el día completo
  action        cancel | replace | add
  ...overrides
```

Cubre clase cancelada, feriado y reunión suelta.

**Capa 3 — Inferencia**

El usuario declara **solo compromisos con nombre** ("clases de 7 a 13, judo de 13 a 15"). El backend deriva el resto al resolver `get_capacity`:

- Huecos cortos entre bloques ocupados no son tiempo útil.
- Tramo posterior a actividad física → `shallow`.
- Tras un bloque largo ocupado se descuenta traslado y comida.
- 20% de descuento general por transiciones y arranque.

**Precedencia de `source`** (de menor a mayor):

1. `inferred` — default calculado por el backend.
2. `asked` — respuesta del usuario a una pregunta puntual del agente, guardada permanentemente.
3. `learned` — derivado de `task_events`. *v2.*
4. `explicit` — declarado directamente por el usuario. Gana siempre.

`get_capacity` devuelve cada bloque con su `source`, para que el agente sepa cuándo vale la pena confirmar y cuándo callarse. Todos los valores son editables en cualquier momento; editar promueve el bloque a `explicit`.

**Perfil de capacidad del usuario:**

```
users
  timezone     "America/Argentina/Buenos_Aires"
  day_start    "07:00"
  day_end      "23:00"
```

La ventana diaria limita el rango en el que se generan huecos inferidos. Los timestamps siguen almacenándose en UTC; `timezone` se usa para resolver fechas locales, día de semana y bloques.

**Estimación y puntos:** la capacidad se calcula exclusivamente en minutos efectivos. `S` estima 15 minutos y vale 1 punto; `M`, 45 minutos y 2 puntos; `L`, 120 minutos y 4 puntos. Los puntos resumen avance en el done-log y el progreso derivado; no son una meta, un límite, una penalización ni una sustitución de los minutos.

**Presupuesto:** capacidad = minutos efectivos tras descuentos, menos minutos reservados por hábitos. El backend no rechaza planes que excedan ese presupuesto: devuelve avisos y registra la decisión del usuario.

**Señales blandas** (avisos, nunca límites): máximo 1 tarea `L` por día, máximo 2 proyectos por día.

### 6.5 Eventos de comportamiento

Tabla `task_events`, append-only. Es **dominio, no telemetría**: vive en la base principal porque `close_day` y la calibración la consultan.

| Campo | Valores |
|---|---|
| `task_id` | |
| `event_type` | `created` · `completed` · `uncompleted` · `rescheduled` · `dropped` · `progress_updated` |
| `occurred_at` | timestamptz |
| `source` | `agent` · `web` |
| `agent_client` | `claude` · `chatgpt` · `gemini` · `null` |
| `metadata` | jsonb (`completion_mode`, bloque origen y destino) |

`tasks` guarda el estado actual; `task_events` guarda cómo se llegó a él.

**Señales derivadas de valor:**

- **Distancia entre bloque planificado y hora real de completado.** La más informativa: revela errores de asignación, no de capacidad.
- **`reschedule_count`.** Tres reprogramaciones indican tarea mal descompuesta o aversiva. Dispara la sugerencia de partirla y la consulta de scripted actions.
- **Ratio full/floor por hábito.** Si un hábito vive en floor durante semanas, el `full` está mal calibrado.
- **`source`.** Mide directamente el criterio de éxito #1.
- **Tasa de aceptación de `propose_tasks`.** Métrica de calidad del contrato del planificador.
- **Cumplimiento por bloque.** Valida o refuta los valores `inferred` de energía. Es el insumo de la capa `learned`.

Dado que la energía y el estado de los bloques nacen inferidos, `task_events` no es una función opcional: es **el mecanismo que corrige las suposiciones del sistema**.

Fuera de alcance: cronometraje de tiempo real por tarea. La fricción de arrancar y parar un timer supera el valor del dato.

Sentry solo para errores del backend. Ninguna herramienta de analítica de producto en v1.

---

## 7. Onboarding

No hay seed automático. Todo el contexto inicial lo carga el usuario, por web o dictándolo al agente.

| Qué carga | Cuándo | Vía preferida |
|---|---|---|
| Horario del ciclo | Una vez por ciclo | Agente (`set_schedule`, dictado en lenguaje natural) |
| Proyectos activos | Al empezar cada uno | Web o agente |
| `spec` de cada proyecto | Al crear el proyecto | Web (se pega el PDF o el enunciado) |
| `approach` + scripted actions | Al crear el proyecto | Agente (conversación) o web |
| Hábitos con su `floor` | Una vez | Web o agente |
| Excepciones | Cuando ocurren | Agente (`create_exception`) |

Criterio de diseño: **el onboarding completo debe tomar menos de quince minutos.** Lo que exceda eso se infiere (§6.4) o se difiere.

El `approach` es el único documento que conviene escribir conversando: el agente pregunta por stack, convenciones y contingencias, y guarda el resultado. Es también el momento en que se resuelve la ambigüedad que originó el producto.

---

## 8. Interfaz MCP

### 8.1 Tools

**Planificación y ejecución**

| Tool | Efecto |
|---|---|
| `list_projects` | Lectura. |
| `get_project_context(id)` | `spec`, `approach` con scripted actions, y `progress` derivado. |
| `get_capacity(date)` | Bloques resueltos con estado, energía, `source` y minutos disponibles, ya descontando hábitos. |
| `get_day(date)` | Tareas del día con estado. Incluye hábitos inyectados. |
| `propose_tasks(date, tasks[], project_id?)` | **No persiste.** Valida el plan que entrega el agente contra contexto y capacidad; no genera la descomposición técnica. Devuelve el plan con avisos para negociar. |
| `create_tasks(...)` | Persiste. Nunca rechaza. Devuelve avisos. |
| `complete_task(id)` | Acepta progreso parcial de batch y `completion_mode` de hábitos. |
| `reschedule(id, date)` | |
| `drop_task(id)` | |
| `close_day(date)` | Totaliza puntos logrados y devuelve opciones de reprogramación contra la capacidad libre de los siguientes 3 días. |

**Configuración**

| Tool | Efecto |
|---|---|
| `set_schedule(...)` | Alta o reemplazo de la plantilla semanal. Acepta descripción en lenguaje natural. |
| `create_exception(...)` | Cancelación, reemplazo o alta puntual para una fecha. |
| `set_block_attribute(...)` | Fija `state` o `energy` de un bloque. Promueve `source` a `asked` o `explicit`. |
| `create_project(...)` | Con `kind` y `deadline` opcional. |
| `set_document(project_id, type, content)` | `spec` o `approach`. |
| `create_habit(...)` | Con `schedule`, `full`, `habit_floor`, `full_minutes` y `floor_minutes`. |

### 8.2 Prompts

Los rituales se exponen como **prompts MCP**, primitiva del protocolo soportada por los tres clientes. No como slash commands, que existen solo en Claude Code.

- **`plan_today`** — lee hábitos inyectados, consulta capacidad y le pide al agente que proponga las tareas clave del día.
- **`close_day`** — ritual de cierre de dos minutos: puntos logrados, pendientes, reprogramación sin amontonar.

### 8.3 Resource

`planning-contract` — el contrato del planificador, releíble por el agente.

### 8.4 Contrato del planificador

Va en la *description* de `propose_tasks` y `create_tasks`, no en documentación externa.

> Llamá a `get_project_context` y `get_capacity` antes de proponer nada. No inventes la descomposición.
>
> Cada tarea debe ser ejecutable en una sola sesión y tener un `done_when` verificable. Si no podés escribirlo, descomponé más.
>
> Si el proyecto no tiene `approach`, no descompongas: preguntá y ofrecé escribirlo.
>
> **Bloques inferidos:** `get_capacity` marca cada bloque con su `source`. Si un bloque relevante para el plan de hoy tiene `source: inferred` y su energía condiciona la asignación, hacé **una** pregunta concreta al usuario y guardá la respuesta con `set_block_attribute`. No vuelvas a preguntar por ese bloque. Nunca hagas más de una pregunta de este tipo por sesión de planificación.
>
> **Arranque:** si existe una tarea `S` sin dependencias en el proyecto activo, ubicala primera en el día — reduce la fricción de arranque. Si no existe, usá el primer ítem de un `batch`. Nunca inventes una tarea de relleno para cumplir esta regla.
>
> Agrupá en `batch` si tres o más tareas comparten verbo y estructura.
>
> Ordená por dependencia real, no por importancia.
>
> **Emparejamiento con energía (preferencia, no restricción):** trabajo `deep` —diseño, depuración, estudio analítico, código complejo— va preferentemente en bloques `deep`. Trabajo mecánico y batches van bien en `shallow`. Los bloques `porous` se prestan a batches `S` y hábitos en floor. El usuario puede ubicar cualquier tarea en cualquier bloque disponible; en ese caso avisá y creala igual.
>
> Los hábitos ya vienen inyectados y ocupan capacidad. No los propongas ni los muevas.
>
> Estudio: nunca "leer el capítulo 3", siempre "resolver 5 ejercicios del capítulo 3 sin apuntes". Ninguna sesión puede cubrir más del 40% del material.
>
> Si el día está sobrecargado, degradá los hábitos a su `habit_floor`. Nunca los elimines.
>
> Si una tarea acumula tres o más reprogramaciones, consultá las scripted actions del `approach` y ofrecé partirla.
>
> No propongas la solución técnica. Proponé el siguiente paso.

### 8.5 Formato de avisos

`create_tasks` devuelve siempre `created` más `warnings[]`:

```
created: 15 tareas (18 pts, 300% de los minutos efectivos de hoy)
warnings:
  - "3 proyectos distintos en un día"
  - "'terminar el módulo' no tiene done_when verificable"
  - "tarea L ubicada en bloque shallow (energía inferida)"
  - "sugerencia: mover 9 tareas a los próximos dos días"
```

---

## 9. Superficies

### 9.1 Web (responsive)

**Vista de día — pantalla principal**

- **Done-log prominente.** Los puntos logrados del día se muestran primero; los pendientes son secundarios. La interfaz refuerza avance, no deuda.
- Tareas por bloque. Hábitos en carril aparte con indicador full/floor.
- Marcar completo. Batch expandible con barra de progreso.

**Configuración**

- Horario: plantilla semanal editable, con los valores inferidos visibles y corregibles.
- Proyectos: CRUD, documentos `spec` y `approach`, progreso derivado.
- Hábitos: CRUD con `full` y `floor`.
- Conexión MCP: URL del servidor e instrucciones por cliente.

### 9.2 Conexión de clientes

El servidor expone un endpoint `/mcp` sobre **Streamable HTTP** con HTTPS y OAuth 2.1. En la revisión MCP `2026-07-28` cada intercambio usa un `POST`; no se implementan sesiones de protocolo, `Mcp-Session-Id`, `GET` para abrir streams ni el transporte HTTP+SSE legado. El servidor puede responder JSON o una respuesta SSE acotada al request; v1 usa JSON salvo que una operación necesite streaming.

Requisito crítico: los metadatos de discovery en `/.well-known/oauth-authorization-server` y `/.well-known/oauth-protected-resource` deben responder correctamente, o los clientes no llegan siquiera a la pantalla de login. Cada request debe incluir `MCP-Protocol-Version`, `Mcp-Method` y, para tools/resources/prompts, `Mcp-Name`.

La implementación actual usa Better Auth para OAuth 2.1 con PKCE, JWT, DCR y login cerrado. Para MCP `2026-07-28`, Client ID Metadata Documents queda como evolución preferida; Dynamic Client Registration es el mecanismo activo de compatibilidad. Los tokens están ligados al `resource` canónico `/mcp`, tienen expiración y se validan contra audiencia y scopes.

| Cliente | Configuración |
|---|---|
| Claude Code | `claude mcp add --transport http planner <url>` |
| Claude Desktop / web | Settings → Connectors → Add custom connector |
| Claude móvil | Hereda los connectors de la cuenta |
| ChatGPT | Developer mode → custom connector. Web únicamente. |
| Gemini CLI | Configuración de servidor MCP remoto |

---

## 10. Criterios de éxito

El MVP funciona si, después de cuatro semanas:

1. Se planifica desde un agente al menos cuatro días por semana. *(Medible por `source` en `task_events`.)*
2. Más del 60% de las tareas creadas se completan o se reprograman explícitamente, sin quedar huérfanas.
3. No hay necesidad de mantener una lista paralela en otro lado.
4. Los hábitos se cumplen — full o floor — al menos el 70% de los días programados.

Si falla el 1, hay fricción en la planificación. Si falla el 2, el planificador genera de más. Si falla el 3, falta cobertura de casos. Si falla el 4, el carril de hábitos no está protegido.

---

## 11. Plan de implementación

**Viernes noche / sábado mañana — Backend y persistencia**

- SQLite: `system.db` para usuarios/OAuth y una base por usuario con `projects`, `documents`, `capacity_blocks`, `capacity_exceptions`, `habits`, `tasks` (unificada con discriminador `kind`) y `task_events`.
- Resolución de capacidad: plantilla + excepciones + inferencia, con `source` por bloque.
- Inyección determinista de hábitos en `get_day`.

**Sábado tarde — Servidor MCP y contrato**

- Tools de planificación y de configuración (§8.1).
- Prompts `plan_today` y `close_day`.
- Resource `planning-contract`.
- Streamable HTTP `2026-07-28` con OAuth 2.1, verificado contra Better Auth y el flujo PKCE. La superficie web responsive inicial vive en el mismo servicio.

**Domingo — Web mínima, despliegue y onboarding**

- Web: vista de día con done-log, marcar completo, y formularios de configuración.
- Despliegue en el VPS con Dokploy.
- Onboarding real: horario del ciclo nuevo, proyectos activos con sus documentos, hábitos.
- Prueba de `plan_today` desde Claude Code y Desktop, dejando el lunes planificado.

**Semana 1 — Uso real, sin cambios de modelo**

Ningún cambio al esquema durante la primera semana. El objetivo es acumular `task_events` de días reales de clase antes de ajustar nada. Solo se permite iterar el contrato del planificador, que es texto en un resource y no requiere desplegar. Al cierre, revisión contra §10.

---

## 12. Riesgos

**Calibración a ciegas.** El estado y la energía de los bloques nacen inferidos. Mitigación: `source` explícito, pregunta puntual del agente, `task_events` desde el día uno, y la regla de no tocar el modelo durante la semana 1.

**Contrato del planificador insuficiente.** Es el componente de mayor riesgo y el único que no se prueba hasta tener agentes operando sobre datos reales. Mitigación: es texto en un resource, iterable sin desplegar.

**Alcance del domingo.** La web dejó de ser opcional al confirmarse que el onboarding es manual: sin formularios de configuración no hay forma de cargar el contexto inicial salvo por tools MCP. Mitigación: si el domingo aprieta, la web se reduce a la vista de día y **todo el onboarding se hace dictándolo al agente**, que es la vía preferida de todos modos. Los formularios pueden esperar a la semana 2.

**Cuarto proyecto activo,** junto a `fpc`, Movistar y OTTARO. El alcance de v1 está recortado deliberadamente para caber en un fin de semana; cualquier ítem de §5.2 que se cuele rompe esa premisa.
