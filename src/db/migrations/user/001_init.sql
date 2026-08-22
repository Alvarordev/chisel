CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('build', 'study')),
  deadline    TEXT,
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'archived')),
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('spec', 'approach')),
  content       TEXT NOT NULL,
  summary       TEXT,
  source        TEXT NOT NULL CHECK (source IN ('upload', 'paste', 'agent')),
  original_name TEXT,
  original_path TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (project_id, type)
);

CREATE TABLE IF NOT EXISTS project_notes (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('agent', 'web')),
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_project ON project_notes(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS capacity_blocks (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  day_of_week  INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time   TEXT NOT NULL,
  end_time     TEXT NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('busy', 'free', 'porous')),
  energy       TEXT CHECK (energy IN ('deep', 'shallow')),
  source       TEXT NOT NULL DEFAULT 'inferred'
               CHECK (source IN ('inferred', 'asked', 'learned', 'explicit')),
  valid_from   TEXT NOT NULL,
  valid_until  TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blocks_dow ON capacity_blocks(day_of_week, valid_from);

CREATE TABLE IF NOT EXISTS capacity_exceptions (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  block_id    TEXT REFERENCES capacity_blocks(id) ON DELETE CASCADE,
  action      TEXT NOT NULL CHECK (action IN ('cancel', 'replace', 'add')),
  label       TEXT,
  start_time  TEXT,
  end_time    TEXT,
  state       TEXT CHECK (state IN ('busy', 'free', 'porous')),
  energy      TEXT CHECK (energy IN ('deep', 'shallow')),
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exceptions_date ON capacity_exceptions(date);

CREATE TABLE IF NOT EXISTS habits (
  id            TEXT PRIMARY KEY,
  action        TEXT NOT NULL,
  full_desc     TEXT NOT NULL,
  habit_floor   TEXT NOT NULL,
  full_minutes  INTEGER NOT NULL CHECK (full_minutes > 0),
  floor_minutes INTEGER NOT NULL CHECK (floor_minutes > 0 AND floor_minutes <= full_minutes),
  schedule      TEXT NOT NULL,
  block_hint    TEXT CHECK (block_hint IN ('morning', 'afternoon', 'evening')),
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'paused')),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('atomic', 'batch', 'habit')),
  action           TEXT NOT NULL,
  done_when        TEXT NOT NULL,
  weight           TEXT NOT NULL CHECK (weight IN ('S', 'M', 'L')),
  scheduled_for    TEXT NOT NULL,
  block            TEXT,
  project_id       TEXT REFERENCES projects(id) ON DELETE CASCADE,
  habit_id         TEXT REFERENCES habits(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'done', 'dropped')),
  blocked_by       TEXT REFERENCES tasks(id),
  due_time         TEXT,
  completion_mode  TEXT CHECK (completion_mode IN ('full', 'floor')),
  completed_at     TEXT,
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_day ON tasks(scheduled_for, status);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_habit_occurrence
  ON tasks(habit_id, scheduled_for)
  WHERE habit_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS batch_items (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  position      INTEGER NOT NULL,
  done          INTEGER NOT NULL DEFAULT 0,
  completed_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_batch_task ON batch_items(task_id, position);

CREATE TABLE IF NOT EXISTS task_events (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL,
  event_type     TEXT NOT NULL CHECK (event_type IN
                 ('created', 'completed', 'uncompleted', 'rescheduled', 'dropped', 'progress_updated')),
  occurred_at    TEXT NOT NULL,
  source         TEXT NOT NULL CHECK (source IN ('agent', 'web')),
  agent_client   TEXT CHECK (agent_client IN ('claude', 'chatgpt', 'gemini')),
  metadata       TEXT,
  scheduled_for  TEXT,
  block          TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_time ON task_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id);
