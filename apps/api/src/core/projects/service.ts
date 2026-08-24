import type { Database } from "bun:sqlite";
import { z } from "zod";
import { nowIso, pointsForWeight } from "../shared.ts";

export const projectKindSchema = z.enum(["build", "study"]);
export const projectStatusSchema = z.enum(["active", "archived"]);

export type Project = {
  id: string;
  name: string;
  kind: "build" | "study";
  deadline: string | null;
  status: "active" | "archived";
  createdAt: string;
  pendingTasks: number;
  completedTasks: number;
};

type ProjectRow = {
  id: string;
  name: string;
  kind: "build" | "study";
  deadline: string | null;
  status: "active" | "archived";
  created_at: string;
  pending_tasks: number;
  completed_tasks: number;
};

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    deadline: row.deadline,
    status: row.status,
    createdAt: row.created_at,
    pendingTasks: row.pending_tasks,
    completedTasks: row.completed_tasks,
  };
}

export function listProjects(
  db: Database,
  status: "active" | "archived" | undefined = "active",
): Project[] {
  const rows = db
    .query<ProjectRow, [string]>(
      `
        SELECT
          p.id, p.name, p.kind, p.deadline, p.status, p.created_at,
          COALESCE(SUM(CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_tasks,
          COALESCE(SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END), 0) AS completed_tasks
        FROM projects p
        LEFT JOIN tasks t ON t.project_id = p.id
        WHERE p.status = ?
        GROUP BY p.id
        ORDER BY p.created_at ASC
      `,
    )
    .all(status);

  return rows.map(mapProject);
}

export function createProject(
  db: Database,
  input: { name: string; kind: "build" | "study"; deadline?: string | null },
): Project {
  const id = crypto.randomUUID();
  const createdAt = nowIso();

  db.query(
    `INSERT INTO projects (id, name, kind, deadline, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)`,
  ).run(id, input.name.trim(), input.kind, input.deadline ?? null, createdAt);

  return {
    id,
    name: input.name.trim(),
    kind: input.kind,
    deadline: input.deadline ?? null,
    status: "active",
    createdAt,
    pendingTasks: 0,
    completedTasks: 0,
  };
}

export function getProjectContext(
  db: Database,
  projectId: string,
  maxLength = 12000,
): {
  project: Project;
  documents: Array<{ id: string; type: "spec" | "approach"; content: string; summary: string | null }>;
  notes: Array<{ id: string; content: string; source: "agent" | "web"; createdAt: string }>;
  progress: {
    completedPoints: number;
    pendingPoints: number;
    completedTasks: number;
    pendingTasks: number;
  };
  warnings: string[];
} {
  const projectRow = db
    .query<ProjectRow, [string]>(
      `
        SELECT
          p.id, p.name, p.kind, p.deadline, p.status, p.created_at,
          COALESCE(SUM(CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_tasks,
          COALESCE(SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END), 0) AS completed_tasks
        FROM projects p
        LEFT JOIN tasks t ON t.project_id = p.id
        WHERE p.id = ?
        GROUP BY p.id
      `,
    )
    .get(projectId);

  if (!projectRow) {
    throw new Error("Project not found");
  }

  const documentRows = db
    .query<
      { id: string; type: "spec" | "approach"; content: string; summary: string | null },
      [string]
    >(`SELECT id, type, content, summary FROM documents WHERE project_id = ? ORDER BY type`)
    .all(projectId);
  const noteRows = db
    .query<
      { id: string; content: string; source: "agent" | "web"; created_at: string },
      [string]
    >(
      `SELECT id, content, source, created_at FROM project_notes WHERE project_id = ? ORDER BY created_at DESC`,
    )
    .all(projectId);
  const taskRows = db
    .query<{ status: "pending" | "done" | "dropped"; weight: "S" | "M" | "L" }, [string]>(
      `SELECT status, weight FROM tasks WHERE project_id = ?`,
    )
    .all(projectId);

  const warnings: string[] = [];
  const documents = documentRows.map((document) => {
    if (document.content.length <= maxLength) {
      return document;
    }

    if (!document.summary) {
      warnings.push(`${document.type} supera ${maxLength} caracteres y no tiene summary`);
    }

    return {
      ...document,
      content: document.content.slice(0, maxLength),
    };
  });

  return {
    project: mapProject(projectRow),
    documents,
    notes: noteRows.map((note) => ({
      id: note.id,
      content: note.content,
      source: note.source,
      createdAt: note.created_at,
    })),
    progress: {
      completedPoints: taskRows
        .filter((task) => task.status === "done")
        .reduce((total, task) => total + pointsForWeight(task.weight), 0),
      pendingPoints: taskRows
        .filter((task) => task.status === "pending")
        .reduce((total, task) => total + pointsForWeight(task.weight), 0),
      completedTasks: taskRows.filter((task) => task.status === "done").length,
      pendingTasks: taskRows.filter((task) => task.status === "pending").length,
    },
    warnings,
  };
}

export function setDocument(
  db: Database,
  input: {
    projectId: string;
    type: "spec" | "approach";
    content: string;
    summary?: string | null;
    source: "upload" | "paste" | "agent";
    originalName?: string | null;
    originalPath?: string | null;
    id?: string;
  },
): { id: string; updatedAt: string } {
  const project = db
    .query<{ id: string }, [string]>(`SELECT id FROM projects WHERE id = ?`)
    .get(input.projectId);

  if (!project) {
    throw new Error("Project not found");
  }

  const existing = db
    .query<{ id: string }, [string, string]>(
      `SELECT id FROM documents WHERE project_id = ? AND type = ?`,
    )
    .get(input.projectId, input.type);
  const id = existing?.id ?? input.id ?? crypto.randomUUID();
  const updatedAt = nowIso();

  db.query(
    `
      INSERT INTO documents (id, project_id, type, content, summary, source, original_name, original_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (project_id, type)
      DO UPDATE SET content = excluded.content, summary = excluded.summary,
                    source = excluded.source, original_name = COALESCE(excluded.original_name, documents.original_name),
                    original_path = COALESCE(excluded.original_path, documents.original_path),
                    updated_at = excluded.updated_at
    `,
  ).run(
    id,
    input.projectId,
    input.type,
    input.content,
    input.summary ?? null,
    input.source,
    input.originalName ?? null,
    input.originalPath ?? null,
    updatedAt,
    updatedAt,
  );

  return { id, updatedAt };
}
