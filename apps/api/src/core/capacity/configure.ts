import type { Database } from "bun:sqlite";
import { z } from "zod";
import type { ActorContext } from "../context.ts";
import { effectiveMinutes, nowIso, parseDate } from "../shared.ts";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

export const scheduleBlockSchema = z.object({
  id: z.string().min(1).optional(),
  label: z.string().trim().min(1),
  dayOfWeek: z.number().int().min(1).max(7),
  startTime: timeSchema,
  endTime: timeSchema,
  state: z.enum(["busy", "free", "porous"]),
  energy: z.enum(["deep", "shallow"]).nullable().optional(),
});

export const scheduleInputSchema = z.object({
  blocks: z.array(scheduleBlockSchema).min(1),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const exceptionInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  blockId: z.string().min(1).nullable().optional(),
  action: z.enum(["cancel", "replace", "add"]),
  label: z.string().trim().min(1).nullable().optional(),
  startTime: timeSchema.nullable().optional(),
  endTime: timeSchema.nullable().optional(),
  state: z.enum(["busy", "free", "porous"]).nullable().optional(),
  energy: z.enum(["deep", "shallow"]).nullable().optional(),
});

export const blockAttributeSchema = z.object({
  blockId: z.string().min(1),
  state: z.enum(["busy", "free", "porous"]).optional(),
  energy: z.enum(["deep", "shallow"]).nullable().optional(),
  source: z.enum(["asked", "explicit"]).default("asked"),
});

function previousDate(date: string): string {
  const value = new Date(`${parseDate(date)}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function validateRange(startTime: string, endTime: string): void {
  effectiveMinutes(startTime, endTime);
}

export type ScheduleBlock = {
  id: string;
  label: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  state: "busy" | "free" | "porous";
  energy: "deep" | "shallow" | null;
  source: "inferred" | "asked" | "learned" | "explicit";
  validFrom: string;
  validUntil: string | null;
};

export function listSchedule(db: Database): { validFrom: string | null; blocks: ScheduleBlock[] } {
  const rows = db
    .query<{
      id: string;
      label: string;
      day_of_week: number;
      start_time: string;
      end_time: string;
      state: "busy" | "free" | "porous";
      energy: "deep" | "shallow" | null;
      source: "inferred" | "asked" | "learned" | "explicit";
      valid_from: string;
      valid_until: string | null;
    }, []>(
      `
        SELECT id, label, day_of_week, start_time, end_time, state, energy, source, valid_from, valid_until
        FROM capacity_blocks
        WHERE valid_until IS NULL
        ORDER BY day_of_week ASC, start_time ASC
      `,
    )
    .all();

  return {
    validFrom: rows[0]?.valid_from ?? null,
    blocks: rows.map((row) => ({
      id: row.id,
      label: row.label,
      dayOfWeek: row.day_of_week,
      startTime: row.start_time,
      endTime: row.end_time,
      state: row.state,
      energy: row.energy,
      source: row.source,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
    })),
  };
}

export function setSchedule(
  db: Database,
  input: z.infer<typeof scheduleInputSchema>,
): { blocks: string[]; validFrom: string } {
  parseDate(input.validFrom);
  input.blocks.forEach((block) => validateRange(block.startTime, block.endTime));
  const createdIds: string[] = [];
  const closeDate = previousDate(input.validFrom);
  const transaction = db.transaction(() => {
    db.query(
      `UPDATE capacity_blocks SET valid_until = ? WHERE valid_until IS NULL AND valid_from < ?`,
    ).run(closeDate, input.validFrom);

    for (const block of input.blocks) {
      const id = block.id ?? crypto.randomUUID();
      db.query(
        `
          INSERT INTO capacity_blocks
            (id, label, day_of_week, start_time, end_time, state, energy, source, valid_from, valid_until, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'explicit', ?, NULL, ?)
        `,
      ).run(
        id,
        block.label,
        block.dayOfWeek,
        block.startTime,
        block.endTime,
        block.state,
        block.energy ?? null,
        input.validFrom,
        nowIso(),
      );
      createdIds.push(id);
    }
  });
  transaction();

  return { blocks: createdIds, validFrom: input.validFrom };
}

export function createException(
  db: Database,
  input: z.infer<typeof exceptionInputSchema>,
): { id: string; date: string } {
  parseDate(input.date);
  if ((input.action === "replace" || input.action === "add") && (!input.startTime || !input.endTime)) {
    throw new Error("replace/add exceptions require startTime and endTime");
  }
  if (input.startTime && input.endTime) validateRange(input.startTime, input.endTime);

  const id = crypto.randomUUID();
  db.query(
    `
      INSERT INTO capacity_exceptions
        (id, date, block_id, action, label, start_time, end_time, state, energy, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    id,
    input.date,
    input.blockId ?? null,
    input.action,
    input.label ?? null,
    input.startTime ?? null,
    input.endTime ?? null,
    input.state ?? null,
    input.energy ?? null,
    nowIso(),
  );

  return { id, date: input.date };
}

export function setBlockAttribute(
  db: Database,
  input: z.infer<typeof blockAttributeSchema>,
): { blockId: string; source: "asked" | "explicit" } {
  if (input.state === undefined && input.energy === undefined) {
    throw new Error("Provide state or energy");
  }
  const existing = db
    .query<{ id: string }, [string]>(`SELECT id FROM capacity_blocks WHERE id = ?`)
    .get(input.blockId);
  if (!existing) throw new Error("Capacity block not found");

  const changes: string[] = [];
  const values: Array<string | null> = [];
  if (input.state !== undefined) {
    changes.push("state = ?");
    values.push(input.state);
  }
  if (input.energy !== undefined) {
    changes.push("energy = ?");
    values.push(input.energy);
  }
  changes.push("source = ?");
  values.push(input.source);
  values.push(input.blockId);
  db.query(`UPDATE capacity_blocks SET ${changes.join(", ")} WHERE id = ?`).run(...values);

  return { blockId: input.blockId, source: input.source };
}

export function addProjectNote(
  db: Database,
  input: { projectId: string; content: string; source: ActorContext["source"] },
): { id: string; createdAt: string } {
  const project = db
    .query<{ id: string }, [string]>(`SELECT id FROM projects WHERE id = ?`)
    .get(input.projectId);
  if (!project) throw new Error("Project not found");

  const id = crypto.randomUUID();
  const createdAt = nowIso();
  db.query(
    `INSERT INTO project_notes (id, project_id, content, source, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.projectId, input.content.trim(), input.source, createdAt);
  return { id, createdAt };
}
