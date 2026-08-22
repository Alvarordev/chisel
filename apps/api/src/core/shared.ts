import type { Database } from "bun:sqlite";
import type { ActorContext } from "./context.ts";

export const weightMinutes = {
  S: 15,
  M: 45,
  L: 120,
} as const;

export const weightPoints = {
  S: 1,
  M: 2,
  L: 4,
} as const;

export type TaskWeight = keyof typeof weightMinutes;

export function nowIso(): string {
  return new Date().toISOString();
}

export function pointsForWeight(weight: TaskWeight): number {
  return weightPoints[weight];
}

export function minutesForWeight(weight: TaskWeight): number {
  return weightMinutes[weight];
}

export function recordTaskEvent(
  db: Database,
  actor: ActorContext,
  input: {
    taskId: string;
    eventType:
      | "created"
      | "completed"
      | "uncompleted"
      | "rescheduled"
      | "dropped"
      | "progress_updated";
    metadata?: Record<string, unknown>;
    scheduledFor?: string;
    block?: string | null;
  },
): void {
  db.query(
    `
      INSERT INTO task_events
        (id, task_id, event_type, occurred_at, source, agent_client, metadata, scheduled_for, block)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    crypto.randomUUID(),
    input.taskId,
    input.eventType,
    nowIso(),
    actor.source,
    actor.agentClient,
    input.metadata ? JSON.stringify(input.metadata) : null,
    input.scheduledFor ?? null,
    input.block ?? null,
  );
}

export function parseDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Date must use YYYY-MM-DD format");
  }

  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid calendar date");
  }

  return value;
}

export function dayOfWeek(date: string): number {
  const day = new Date(`${parseDate(date)}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function effectiveMinutes(startTime: string, endTime: string): number {
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  const minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);

  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw new Error(`Invalid time range: ${startTime}-${endTime}`);
  }

  return minutes;
}
