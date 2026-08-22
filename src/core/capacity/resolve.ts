import type { Database } from "bun:sqlite";
import type { UserProfile } from "../../db/system.ts";
import { habitsForDay } from "../habits/service.ts";
import { dayOfWeek, effectiveMinutes, parseDate } from "../shared.ts";

type CapacityRow = {
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

type ExceptionRow = {
  id: string;
  block_id: string | null;
  action: "cancel" | "replace" | "add";
  label: string | null;
  start_time: string | null;
  end_time: string | null;
  state: "busy" | "free" | "porous" | null;
  energy: "deep" | "shallow" | null;
};

export type ResolvedCapacityBlock = {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  state: "busy" | "free" | "porous";
  energy: "deep" | "shallow" | null;
  source: "inferred" | "asked" | "learned" | "explicit";
  rawMinutes: number;
  effectiveMinutes: number;
};

export type HabitReservation = {
  taskId: string;
  habitId: string;
  action: string;
  mode: "full" | "floor";
  minutes: number;
};

export type ResolvedCapacity = {
  date: string;
  blocks: ResolvedCapacityBlock[];
  habitReservations: HabitReservation[];
  availableMinutesBeforeHabits: number;
  availableMinutes: number;
  warnings: string[];
};

function inValidityRange(row: CapacityRow, date: string): boolean {
  return row.valid_from <= date && (row.valid_until === null || date <= row.valid_until);
}

function daypart(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function createInferredGaps(
  profile: UserProfile,
  busyBlocks: Array<{ startTime: string; endTime: string }>,
): ResolvedCapacityBlock[] {
  const boundaries = [
    { startTime: profile.dayStart, endTime: busyBlocks[0]?.startTime ?? profile.dayEnd },
    ...busyBlocks.slice(0, -1).map((block, index) => ({
      startTime: block.endTime,
      endTime: busyBlocks[index + 1]?.startTime ?? profile.dayEnd,
    })),
    ...(busyBlocks.length > 0
      ? [{ startTime: busyBlocks.at(-1)!.endTime, endTime: profile.dayEnd }]
      : []),
  ];

  return boundaries
    .filter((gap) => gap.startTime < gap.endTime && effectiveMinutes(gap.startTime, gap.endTime) >= 30)
    .map((gap, index) => {
      const rawMinutes = effectiveMinutes(gap.startTime, gap.endTime);
      const hour = Number(gap.startTime.slice(0, 2));
      return {
        id: `inferred:${index}:${gap.startTime}`,
        label: "Tiempo disponible",
        startTime: gap.startTime,
        endTime: gap.endTime,
        state: "free" as const,
        energy: daypart(hour) === "afternoon" ? ("shallow" as const) : ("deep" as const),
        source: "inferred" as const,
        rawMinutes,
        effectiveMinutes: Math.floor(rawMinutes * 0.8),
      };
    });
}

export function resolveCapacity(
  db: Database,
  profile: UserProfile,
  inputDate: string,
): ResolvedCapacity {
  const date = parseDate(inputDate);
  const rows = db
    .query<CapacityRow, [number]>(
      `
        SELECT id, label, day_of_week, start_time, end_time, state, energy, source, valid_from, valid_until
        FROM capacity_blocks
        WHERE day_of_week = ?
        ORDER BY start_time ASC
      `,
    )
    .all(dayOfWeek(date))
    .filter((row) => inValidityRange(row, date));
  const exceptions = db
    .query<ExceptionRow, [string]>(
      `SELECT id, block_id, action, label, start_time, end_time, state, energy FROM capacity_exceptions WHERE date = ?`,
    )
    .all(date);
  const cancelledIds = new Set(
    exceptions.filter((exception) => exception.action === "cancel" && exception.block_id).map((exception) => exception.block_id!),
  );
  const replaced = new Map(
    exceptions
      .filter((exception) => exception.action === "replace" && exception.block_id)
      .map((exception) => [exception.block_id!, exception]),
  );

  const resolvedExplicit = rows
    .filter((row) => !cancelledIds.has(row.id))
    .map((row) => {
      const override = replaced.get(row.id);
      const startTime = override?.start_time ?? row.start_time;
      const endTime = override?.end_time ?? row.end_time;
      const state = override?.state ?? row.state;
      const rawMinutes = effectiveMinutes(startTime, endTime);
      return {
        id: row.id,
        label: override?.label ?? row.label,
        startTime,
        endTime,
        state,
        energy: override?.energy ?? row.energy,
        source: row.source,
        rawMinutes,
        effectiveMinutes: state === "busy" ? 0 : Math.floor(rawMinutes * 0.8),
      };
    });
  const busyBlocks = resolvedExplicit
    .filter((block) => block.state === "busy")
    .map(({ startTime, endTime }) => ({ startTime, endTime }));
  const inferredGaps = createInferredGaps(profile, busyBlocks);
  const added = exceptions
    .filter((exception) => exception.action === "add" && exception.start_time && exception.end_time)
    .map((exception) => {
      const rawMinutes = effectiveMinutes(exception.start_time!, exception.end_time!);
      return {
        id: exception.id,
        label: exception.label ?? "Excepción",
        startTime: exception.start_time!,
        endTime: exception.end_time!,
        state: exception.state ?? "busy",
        energy: exception.energy,
        source: "explicit" as const,
        rawMinutes,
        effectiveMinutes: exception.state === "busy" ? 0 : Math.floor(rawMinutes * 0.8),
      };
    });
  const blocks = [...resolvedExplicit, ...inferredGaps, ...added].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );
  const availableMinutesBeforeHabits = blocks.reduce(
    (total, block) => total + (block.state === "busy" ? 0 : block.effectiveMinutes),
    0,
  );
  const scheduledHabits = habitsForDay(db, date);
  let remaining = availableMinutesBeforeHabits;
  const habitReservations = scheduledHabits.map((habit) => {
    if (habit.completionMode === "full") {
      remaining -= habit.fullMinutes;
      return {
        taskId: habit.taskId,
        habitId: habit.id,
        action: habit.action,
        mode: "full" as const,
        minutes: habit.fullMinutes,
      };
    }

    if (habit.completionMode === "floor") {
      remaining -= habit.floorMinutes;
      return {
        taskId: habit.taskId,
        habitId: habit.id,
        action: habit.action,
        mode: "floor" as const,
        minutes: habit.floorMinutes,
      };
    }

    if (remaining >= habit.fullMinutes) {
      remaining -= habit.fullMinutes;
      return {
        taskId: habit.taskId,
        habitId: habit.id,
        action: habit.action,
        mode: "full" as const,
        minutes: habit.fullMinutes,
      };
    }

    if (remaining >= habit.floorMinutes) {
      remaining -= habit.floorMinutes;
      return {
        taskId: habit.taskId,
        habitId: habit.id,
        action: habit.action,
        mode: "floor" as const,
        minutes: habit.floorMinutes,
      };
    }

    return {
      taskId: habit.taskId,
      habitId: habit.id,
      action: habit.action,
      mode: "floor" as const,
      minutes: habit.floorMinutes,
    };
  });
  const reservedMinutes = habitReservations.reduce((total, habit) => total + habit.minutes, 0);
  const warnings: string[] = [];

  if (reservedMinutes > availableMinutesBeforeHabits) {
    warnings.push("Los hábitos ocupan más minutos que la capacidad disponible; se mantienen sin bloquear al usuario");
  }

  return {
    date,
    blocks,
    habitReservations,
    availableMinutesBeforeHabits,
    availableMinutes: Math.max(0, availableMinutesBeforeHabits - reservedMinutes),
    warnings,
  };
}
