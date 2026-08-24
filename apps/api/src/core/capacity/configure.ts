import type { Database } from "bun:sqlite";
import { z } from "zod";
import type { ActorContext } from "../context.ts";
import { effectiveMinutes, nowIso, parseDate } from "../shared.ts";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

export const scheduleBlockSchema = z.object({
  id: z.string().min(1).optional(),
  label: z.string().trim().min(1),
  dayOfWeek: z.number().int().min(1).max(7),
  startTime: timeSchema,
  endTime: timeSchema,
  state: z.enum(["busy", "free", "porous"]),
  energy: z.enum(["deep", "shallow"]).nullable().optional(),
  validFrom: dateSchema.optional(),
  validUntil: dateSchema.nullable().optional(),
});

export const scheduleBlockWriteSchema = scheduleBlockSchema.omit({ id: true });

export const scheduleBlockUpdateSchema = scheduleBlockWriteSchema.partial();

export const scheduleInputSchema = z.object({
  blocks: z.array(scheduleBlockSchema).min(1),
  validFrom: dateSchema.optional(),
});

export const exceptionInputSchema = z.object({
  date: dateSchema,
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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function validateRange(startTime: string, endTime: string): void {
  effectiveMinutes(startTime, endTime);
}

function validateValidity(validFrom: string, validUntil: string | null | undefined): void {
  parseDate(validFrom);
  if (validUntil !== undefined && validUntil !== null) {
    parseDate(validUntil);
    if (validUntil < validFrom) {
      throw new Error("validUntil cannot be before validFrom");
    }
  }
}

type CapacityBlockRow = {
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
};

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

function mapScheduleBlock(row: CapacityBlockRow): ScheduleBlock {
  return {
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
  };
}

function isActiveOnDate(row: { valid_from: string; valid_until: string | null }, asOf: string): boolean {
  return row.valid_from <= asOf && (row.valid_until === null || row.valid_until >= asOf);
}

export function listSchedule(db: Database, asOf = todayIso()): { asOf: string; blocks: ScheduleBlock[] } {
  parseDate(asOf);
  const rows = db
    .query<CapacityBlockRow, []>(
      `
        SELECT id, label, day_of_week, start_time, end_time, state, energy, source, valid_from, valid_until
        FROM capacity_blocks
        ORDER BY day_of_week ASC, start_time ASC
      `,
    )
    .all()
    .filter((row) => isActiveOnDate(row, asOf));

  return { asOf, blocks: rows.map(mapScheduleBlock) };
}

function getScheduleBlockRow(db: Database, id: string): CapacityBlockRow {
  const row = db
    .query<CapacityBlockRow, [string]>(
      `
        SELECT id, label, day_of_week, start_time, end_time, state, energy, source, valid_from, valid_until
        FROM capacity_blocks WHERE id = ?
      `,
    )
    .get(id);
  if (!row) throw new Error("Capacity block not found");
  return row;
}

export function createScheduleBlock(
  db: Database,
  input: z.infer<typeof scheduleBlockWriteSchema>,
): ScheduleBlock {
  validateRange(input.startTime, input.endTime);
  const validFrom = input.validFrom ?? todayIso();
  validateValidity(validFrom, input.validUntil ?? null);

  const id = crypto.randomUUID();
  db.query(
    `
      INSERT INTO capacity_blocks
        (id, label, day_of_week, start_time, end_time, state, energy, source, valid_from, valid_until, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'explicit', ?, ?, ?)
    `,
  ).run(
    id,
    input.label,
    input.dayOfWeek,
    input.startTime,
    input.endTime,
    input.state,
    input.energy ?? null,
    validFrom,
    input.validUntil ?? null,
    nowIso(),
  );

  return mapScheduleBlock(getScheduleBlockRow(db, id));
}

export function updateScheduleBlock(
  db: Database,
  id: string,
  input: z.infer<typeof scheduleBlockUpdateSchema>,
): ScheduleBlock {
  const existing = getScheduleBlockRow(db, id);
  const next = {
    label: input.label ?? existing.label,
    dayOfWeek: input.dayOfWeek ?? existing.day_of_week,
    startTime: input.startTime ?? existing.start_time,
    endTime: input.endTime ?? existing.end_time,
    state: input.state ?? existing.state,
    energy: input.energy !== undefined ? input.energy : existing.energy,
    validFrom: input.validFrom ?? existing.valid_from,
    validUntil: input.validUntil !== undefined ? input.validUntil : existing.valid_until,
  };

  validateRange(next.startTime, next.endTime);
  validateValidity(next.validFrom, next.validUntil);

  db.query(
    `
      UPDATE capacity_blocks
      SET label = ?, day_of_week = ?, start_time = ?, end_time = ?, state = ?, energy = ?,
          valid_from = ?, valid_until = ?, source = 'explicit'
      WHERE id = ?
    `,
  ).run(
    next.label,
    next.dayOfWeek,
    next.startTime,
    next.endTime,
    next.state,
    next.energy,
    next.validFrom,
    next.validUntil,
    id,
  );

  return mapScheduleBlock(getScheduleBlockRow(db, id));
}

export function closeScheduleBlock(db: Database, id: string, asOf = todayIso()): ScheduleBlock {
  parseDate(asOf);
  getScheduleBlockRow(db, id);
  const closeDate = previousDate(asOf);
  db.query(`UPDATE capacity_blocks SET valid_until = ? WHERE id = ?`).run(closeDate, id);
  return mapScheduleBlock(getScheduleBlockRow(db, id));
}

export function setSchedule(
  db: Database,
  input: z.infer<typeof scheduleInputSchema>,
): { blocks: string[] } {
  const defaultValidFrom = input.validFrom ? parseDate(input.validFrom) : todayIso();
  const createdIds: string[] = [];

  const transaction = db.transaction(() => {
    for (const block of input.blocks) {
      validateRange(block.startTime, block.endTime);
      const validFrom = block.validFrom ?? defaultValidFrom;
      validateValidity(validFrom, block.validUntil ?? null);

      if (block.id) {
        const existing = db
          .query<{ id: string }, [string]>(`SELECT id FROM capacity_blocks WHERE id = ?`)
          .get(block.id);
        if (existing) {
          updateScheduleBlock(db, block.id, {
            label: block.label,
            dayOfWeek: block.dayOfWeek,
            startTime: block.startTime,
            endTime: block.endTime,
            state: block.state,
            energy: block.energy,
            validFrom,
            validUntil: block.validUntil ?? null,
          });
          createdIds.push(block.id);
          continue;
        }
      }

      const created = createScheduleBlock(db, {
        label: block.label,
        dayOfWeek: block.dayOfWeek,
        startTime: block.startTime,
        endTime: block.endTime,
        state: block.state,
        energy: block.energy,
        validFrom,
        validUntil: block.validUntil ?? null,
      });
      createdIds.push(created.id);
    }
  });
  transaction();

  return { blocks: createdIds };
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
