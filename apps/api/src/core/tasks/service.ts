import type { Database } from "bun:sqlite";
import { z } from "zod";
import type { ActorContext } from "../context.ts";
import { completeHabit, habitsForDay } from "../habits/service.ts";
import {
  minutesForWeight,
  nowIso,
  parseDate,
  pointsForWeight,
  recordTaskEvent,
} from "../shared.ts";

export const taskDraftSchema = z.object({
  kind: z.enum(["atomic", "batch"]).default("atomic"),
  action: z.string().trim().min(1),
  doneWhen: z.string().trim().min(1),
  weight: z.enum(["S", "M", "L"]),
  block: z.string().trim().nullable().optional(),
  projectId: z.string().trim().nullable().optional(),
  blockedBy: z.string().trim().nullable().optional(),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  items: z.array(z.string().trim().min(1)).optional(),
});

export type TaskDraft = z.infer<typeof taskDraftSchema>;

export type Task = {
  id: string;
  kind: "atomic" | "batch" | "habit";
  action: string;
  doneWhen: string;
  weight: "S" | "M" | "L";
  scheduledFor: string;
  block: string | null;
  projectId: string | null;
  habitId: string | null;
  status: "pending" | "done" | "dropped";
  blockedBy: string | null;
  dueTime: string | null;
  completionMode: "full" | "floor" | null;
  completedAt: string | null;
  points: number;
  estimatedMinutes: number;
  items?: Array<{ id: string; label: string; done: boolean; completedAt: string | null }>;
};

type TaskRow = {
  id: string;
  kind: "atomic" | "batch" | "habit";
  action: string;
  done_when: string;
  weight: "S" | "M" | "L";
  scheduled_for: string;
  block: string | null;
  project_id: string | null;
  habit_id: string | null;
  status: "pending" | "done" | "dropped";
  blocked_by: string | null;
  due_time: string | null;
  completion_mode: "full" | "floor" | null;
  completed_at: string | null;
};

function mapTask(row: TaskRow, items?: Task["items"]): Task {
  return {
    id: row.id,
    kind: row.kind,
    action: row.action,
    doneWhen: row.done_when,
    weight: row.weight,
    scheduledFor: row.scheduled_for,
    block: row.block,
    projectId: row.project_id,
    habitId: row.habit_id,
    status: row.status,
    blockedBy: row.blocked_by,
    dueTime: row.due_time,
    completionMode: row.completion_mode,
    completedAt: row.completed_at,
    points: row.kind === "habit" ? 0 : pointsForWeight(row.weight),
    estimatedMinutes: row.kind === "habit" ? 0 : minutesForWeight(row.weight),
    ...(items ? { items } : {}),
  };
}

function taskItems(db: Database, taskId: string): NonNullable<Task["items"]> {
  return db
    .query<
      { id: string; label: string; done: number; completed_at: string | null },
      [string]
    >(`SELECT id, label, done, completed_at FROM batch_items WHERE task_id = ? ORDER BY position`)
    .all(taskId)
    .map((item) => ({
      id: item.id,
      label: item.label,
      done: item.done === 1,
      completedAt: item.completed_at,
    }));
}

export function getDay(db: Database, date: string): { date: string; tasks: Task[]; habits: ReturnType<typeof habitsForDay> } {
  parseDate(date);
  const rows = db
    .query<TaskRow, [string]>(
      `
        SELECT id, kind, action, done_when, weight, scheduled_for, block, project_id, habit_id,
               status, blocked_by, due_time, completion_mode, completed_at
        FROM tasks WHERE scheduled_for = ? AND habit_id IS NULL AND status != 'dropped'
        ORDER BY block, created_at
      `,
    )
    .all(date);
  const tasks = rows.map((row) => mapTask(row, row.kind === "batch" ? taskItems(db, row.id) : undefined));

  return { date, tasks, habits: habitsForDay(db, date) };
}

export function createTasks(
  db: Database,
  actor: ActorContext,
  input: { date: string; tasks: TaskDraft[] },
): { created: Task[]; warnings: string[]; totalPoints: number; totalMinutes: number } {
  const date = parseDate(input.date);
  const warnings: string[] = [];
  const created: Task[] = [];
  const transaction = db.transaction(() => {
    for (const draft of input.tasks) {
      if (draft.doneWhen.trim().length < 3) {
        warnings.push(`'${draft.action}' tiene un done_when poco verificable`);
      }
      if (draft.kind === "batch" && (!draft.items || draft.items.length < 2)) {
        warnings.push(`'${draft.action}' es batch pero tiene menos de dos items`);
      }
      const id = crypto.randomUUID();
      const createdAt = nowIso();
      db.query(
        `
          INSERT INTO tasks
            (id, kind, action, done_when, weight, scheduled_for, block, project_id, status, blocked_by, due_time, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        `,
      ).run(
        id,
        draft.kind,
        draft.action,
        draft.doneWhen,
        draft.weight,
        date,
        draft.block ?? null,
        draft.projectId ?? null,
        draft.blockedBy ?? null,
        draft.dueTime ?? null,
        createdAt,
      );

      const items = draft.kind === "batch" ? draft.items ?? [] : [];
      items.forEach((label, position) => {
        db.query(
          `INSERT INTO batch_items (id, task_id, label, position) VALUES (?, ?, ?, ?)`,
        ).run(crypto.randomUUID(), id, label, position);
      });

      recordTaskEvent(db, actor, {
        taskId: id,
        eventType: "created",
        scheduledFor: date,
        block: draft.block,
        metadata: { kind: draft.kind, weight: draft.weight },
      });

      const row = db
        .query<TaskRow, [string]>(
          `SELECT id, kind, action, done_when, weight, scheduled_for, block, project_id, habit_id, status, blocked_by, due_time, completion_mode, completed_at FROM tasks WHERE id = ?`,
        )
        .get(id)!;
      created.push(mapTask(row, items.length > 0 ? taskItems(db, id) : undefined));
    }
  });
  transaction();

  const totalPoints = created.reduce((total, task) => total + task.points, 0);
  const totalMinutes = created.reduce((total, task) => total + task.estimatedMinutes, 0);
  if (created.filter((task) => task.projectId).map((task) => task.projectId).filter(Boolean).length > 0) {
    const projectIds = new Set(created.map((task) => task.projectId).filter(Boolean));
    if (projectIds.size > 2) warnings.push("Más de dos proyectos distintos en un día");
  }

  return { created, warnings, totalPoints, totalMinutes };
}

export function completeTask(
  db: Database,
  actor: ActorContext,
  input: { taskId: string; completionMode?: "full" | "floor"; itemIds?: string[] },
): Task | ReturnType<typeof completeHabit> {
  if (input.taskId.startsWith("habit:")) {
    const date = input.taskId.slice(-10);
    return completeHabit(db, actor, {
      taskId: input.taskId,
      date,
      completionMode: input.completionMode ?? "full",
    });
  }

  const row = db
    .query<TaskRow, [string]>(
      `SELECT id, kind, action, done_when, weight, scheduled_for, block, project_id, habit_id, status, blocked_by, due_time, completion_mode, completed_at FROM tasks WHERE id = ?`,
    )
    .get(input.taskId);
  if (!row) throw new Error("Task not found");
  if (row.kind === "batch" && input.itemIds?.length) {
    const updatedAt = nowIso();
    for (const itemId of input.itemIds) {
      db.query(`UPDATE batch_items SET done = 1, completed_at = ? WHERE id = ? AND task_id = ?`).run(
        updatedAt,
        itemId,
        row.id,
      );
    }
    const remaining = db
      .query<{ count: number }, [string]>(
        `SELECT COUNT(*) AS count FROM batch_items WHERE task_id = ? AND done = 0`,
      )
      .get(row.id)!;
    if (remaining.count > 0) {
      recordTaskEvent(db, actor, {
        taskId: row.id,
        eventType: "progress_updated",
        scheduledFor: row.scheduled_for,
        block: row.block,
        metadata: { item_ids: input.itemIds },
      });
      const refreshed = { ...row };
      return mapTask(refreshed, taskItems(db, row.id));
    }
  }

  const completedAt = nowIso();
  db.query(`UPDATE tasks SET status = 'done', completed_at = ? WHERE id = ?`).run(completedAt, row.id);
  recordTaskEvent(db, actor, {
    taskId: row.id,
    eventType: "completed",
    scheduledFor: row.scheduled_for,
    block: row.block,
  });
  const updated = { ...row, status: "done" as const, completed_at: completedAt };
  return mapTask(updated, row.kind === "batch" ? taskItems(db, row.id) : undefined);
}

export function rescheduleTask(
  db: Database,
  actor: ActorContext,
  input: { taskId: string; date: string; block?: string | null },
): Task {
  const date = parseDate(input.date);
  const row = db
    .query<TaskRow, [string]>(
      `SELECT id, kind, action, done_when, weight, scheduled_for, block, project_id, habit_id, status, blocked_by, due_time, completion_mode, completed_at FROM tasks WHERE id = ?`,
    )
    .get(input.taskId);
  if (!row) throw new Error("Task not found");
  if (row.kind === "habit") throw new Error("Habits cannot be rescheduled");

  db.query(`UPDATE tasks SET scheduled_for = ?, block = ? WHERE id = ?`).run(
    date,
    input.block ?? row.block,
    row.id,
  );
  recordTaskEvent(db, actor, {
    taskId: row.id,
    eventType: "rescheduled",
    scheduledFor: date,
    block: input.block ?? row.block,
    metadata: { from: row.scheduled_for, to: date },
  });
  return mapTask({ ...row, scheduled_for: date, block: input.block ?? row.block }, row.kind === "batch" ? taskItems(db, row.id) : undefined);
}

function dropTaskRow(db: Database, actor: ActorContext, row: TaskRow): Task {
  if (row.kind === "habit") throw new Error("Habits cannot be dropped");
  if (row.status === "dropped") {
    return mapTask(row, row.kind === "batch" ? taskItems(db, row.id) : undefined);
  }

  db.query(`UPDATE tasks SET status = 'dropped' WHERE id = ?`).run(row.id);
  recordTaskEvent(db, actor, {
    taskId: row.id,
    eventType: "dropped",
    scheduledFor: row.scheduled_for,
    block: row.block,
  });
  return mapTask({ ...row, status: "dropped" }, row.kind === "batch" ? taskItems(db, row.id) : undefined);
}

export function dropTask(db: Database, actor: ActorContext, taskId: string): Task {
  const row = db
    .query<TaskRow, [string]>(
      `SELECT id, kind, action, done_when, weight, scheduled_for, block, project_id, habit_id, status, blocked_by, due_time, completion_mode, completed_at FROM tasks WHERE id = ?`,
    )
    .get(taskId);
  if (!row) throw new Error("Task not found");
  return dropTaskRow(db, actor, row);
}

export function dropTasks(
  db: Database,
  actor: ActorContext,
  input: { taskIds?: string[]; date?: string; pendingOnly?: boolean },
): { dropped: Task[] } {
  const dropped: Task[] = [];

  if (input.taskIds?.length) {
    const transaction = db.transaction(() => {
      for (const taskId of input.taskIds!) {
        const row = db
          .query<TaskRow, [string]>(
            `SELECT id, kind, action, done_when, weight, scheduled_for, block, project_id, habit_id, status, blocked_by, due_time, completion_mode, completed_at FROM tasks WHERE id = ?`,
          )
          .get(taskId);
        if (!row) throw new Error(`Task not found: ${taskId}`);
        if (input.pendingOnly && row.status !== "pending") continue;
        dropped.push(dropTaskRow(db, actor, row));
      }
    });
    transaction();
    return { dropped };
  }

  if (input.date && input.pendingOnly) {
    const date = parseDate(input.date);
    const rows = db
      .query<TaskRow, [string]>(
        `
          SELECT id, kind, action, done_when, weight, scheduled_for, block, project_id, habit_id,
                 status, blocked_by, due_time, completion_mode, completed_at
          FROM tasks
          WHERE scheduled_for = ? AND habit_id IS NULL AND status = 'pending'
        `,
      )
      .all(date);
    const transaction = db.transaction(() => {
      for (const row of rows) {
        dropped.push(dropTaskRow(db, actor, row));
      }
    });
    transaction();
    return { dropped };
  }

  throw new Error("Provide taskIds or date with pendingOnly");
}
