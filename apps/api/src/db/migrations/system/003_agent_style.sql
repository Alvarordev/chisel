ALTER TABLE users ADD COLUMN agent_style TEXT NOT NULL DEFAULT 'direct'
  CHECK (agent_style IN ('direct', 'conversational'));
