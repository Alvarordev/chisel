import type { Database } from "bun:sqlite";
import { z } from "zod";
import type { ActorContext } from "../context.ts";
import { dayOfWeek, nowIso, recordTaskEvent } from "../shared.ts";

export const habitInputSchema = z.object({
  action: z.string().trim().min(1),
  fullDesc: z.string().trim().min(1),
  habitFloor: z.string().trim().min(1),
  fullMinutes: z.number().int().positive(),
  floorMinutes: z.number().int().positive(),
  schedule: z.array(z.number().int().min(1).max(7)).min(1),
  blockHint: z.enum(["morning", "afternoon", "evening"]).nullable().optional(),
});

export type Habit = {
  id: string;
  action: string;
  fullDesc: string;
  habitFloor: string;
  fullMinutes: number;
  floorMinutes: number;
  schedule: number[];
  blockHint: "morning" | "afternoon" | "evening" | null;
  status: "active" | "paused";
};

type HabitRow = {
  id: string;
  action: string;
  full_desc: string;
  habit_floor: string;
  full_minutes: number;
  floor_minutes: number;
  schedule: string;
  block_hint: "morning" | "afternoon" | "evening" | null;
  status: "active" | "paused";
};

export type DayHabit = Omit<Habit, "status"> & {
  scheduledFor: string;
  taskId: string;
  kind: "habit";
  doneWhen: string;
  status: "pending" | "done" | "dropped";
  completionMode: "full" | "floor" | null;
  isVirtual: boolean;
  estimatedMinutes: number;
};

function mapHabit(row: HabitRow): Habit {
  return {
    id: row.id,
    action: row.action,
    fullDesc: row.full_desc,
    habitFloor: row.habit_floor,
    fullMinutes: row.full_minutes,
    floorMinutes: row.floor_minutes,
    schedule: JSON.parse(row.schedule) as number[],
    blockHint: row.block_hint,
    status: row.status,
  };
}

export function listHabits(db: Database): Habit[] {
  return db
    .query<HabitRow, []>(`SELECT * FROM habits ORDER BY created_at ASC`)
    .all()
    .map(mapHabit);
}

export function createHabit(db: Database, input: z.infer<typeof habitInputSchema>): Habit {
  if (input.floorMinutes > input.fullMinutes) {
    throw new Error("floorMinutes cannot exceed fullMinutes");
  }

  const id = crypto.randomUUID();
  db.query(
    `
      INSERT INTO habits
        (id, action, full_desc, habit_floor, full_minutes, floor_minutes, schedule, block_hint, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    id,
    input.action,
    input.fullDesc,
    input.habitFloor,
    input.fullMinutes,
    input.floorMinutes,
    JSON.stringify([...new Set(input.schedule)].sort()),
    input.blockHint ?? null,
    nowIso(),
  );

  return {
    id,
    action: input.action,
    fullDesc: input.fullDesc,
    habitFloor: input.habitFloor,
    fullMinutes: input.fullMinutes,
    floorMinutes: input.floorMinutes,
    schedule: [...new Set(input.schedule)].sort(),
    blockHint: input.blockHint ?? null,
    status: "active",
  };
}

export function habitsForDay(db: Database, date: string): DayHabit[] {
  const weekday = dayOfWeek(date);
  const habits = db
    .query<HabitRow, []>(`SELECT * FROM habits WHERE status = 'active' ORDER BY created_at ASC`)
    .all()
    .map(mapHabit)
    .filter((habit) => habit.schedule.includes(weekday));
  const taskRows = db
    .query<
      {
        id: string;
        habit_id: string;
        status: "pending" | "done" | "dropped";
        completion_mode: "full" | "floor" | null;
      },
      [string]
    >(`SELECT id, habit_id, status, completion_mode FROM tasks WHERE scheduled_for = ? AND habit_id IS NOT NULL`)
    .all(date);
  const taskByHabit = new Map(taskRows.map((task) => [task.habit_id, task]));

  return habits.map((habit) => {
    const task = taskByHabit.get(habit.id);
    return {
      ...habit,
      scheduledFor: date,
      taskId: task?.id ?? `habit:${habit.id}:${date}`,
      kind: "habit",
      doneWhen: habit.fullDesc,
      status: task?.status ?? "pending",
      completionMode: task?.completion_mode ?? null,
      isVirtual: !task,
      estimatedMinutes:
        task?.completion_mode === "floor" ? habit.floorMinutes : habit.fullMinutes,
    };
  });
}

export function completeHabit(
  db: Database,
  actor: ActorContext,
  input: { taskId: string; date: string; completionMode: "full" | "floor" },
): DayHabit {
  const existing = db
    .query<
      {
        id: string;
        habit_id: string;
        scheduled_for: string;
        status: "pending" | "done" | "dropped";
        completion_mode: "full" | "floor" | null;
      },
      [string]
    >(`SELECT id, habit_id, scheduled_for, status, completion_mode FROM tasks WHERE id = ?`)
    .get(input.taskId);

  let taskId = input.taskId;
  if (!existing) {
    const match = /^habit:([^:]+):(\d{4}-\d{2}-\d{2})$/.exec(input.taskId);
    if (!match || match[2] !== input.date) {
      throw new Error("Habit occurrence not found");
    }

    const habit = db
      .query<HabitRow, [string]>(`SELECT * FROM habits WHERE id = ? AND status = 'active'`)
      .get(match[1]);
    if (!habit) {
      throw new Error("Habit not found or paused");
    }

    db.query(
      `
        INSERT INTO tasks
          (id, kind, action, done_when, weight, scheduled_for, block, habit_id, status, completion_mode, completed_at, created_at)
        VALUES (?, 'habit', ?, ?, 'S', ?, ?, ?, 'done', ?, ?, ?)
      `,
    ).run(
      taskId,
      habit.action,
      habit.full_desc,
      input.date,
      habit.block_hint,
      habit.id,
      input.completionMode,
      nowIso(),
      nowIso(),
    );
  } else {
    db.query(
      `UPDATE tasks SET status = 'done', completion_mode = ?, completed_at = ? WHERE id = ?`,
    ).run(input.completionMode, nowIso(), input.taskId);
  }

  const habitRow = db
    .query<HabitRow, [string]>(
      `SELECT h.* FROM habits h JOIN tasks t ON t.habit_id = h.id WHERE t.id = ?`,
    )
    .get(taskId);
  if (!habitRow) {
    throw new Error("Habit occurrence not found after completion");
  }

  recordTaskEvent(db, actor, {
    taskId,
    eventType: "completed",
    metadata: { completion_mode: input.completionMode },
    scheduledFor: input.date,
    block: habitRow.block_hint,
  });

  return habitsForDay(db, input.date).find((habit) => habit.taskId === taskId) as DayHabit;
}
