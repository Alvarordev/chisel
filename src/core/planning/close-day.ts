import type { Database } from "bun:sqlite";
import type { UserProfile } from "../../db/system.ts";
import { resolveCapacity } from "../capacity/resolve.ts";
import { getDay } from "../tasks/service.ts";
import { parseDate } from "../shared.ts";

function nextDate(date: string, offset: number): string {
  const value = new Date(`${parseDate(date)}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

export function closeDay(input: {
  db: Database;
  profile: UserProfile;
  date: string;
}): {
  date: string;
  completed: { tasks: number; points: number };
  pending: Array<{ id: string; action: string; weight: "S" | "M" | "L"; points: number }>;
  nextDays: Array<{ date: string; availableMinutes: number; warnings: string[] }>;
} {
  const day = getDay(input.db, input.date);
  const pending = day.tasks
    .filter((task) => task.status === "pending")
    .map((task) => ({ id: task.id, action: task.action, weight: task.weight, points: task.points }));
  const completed = day.tasks.filter((task) => task.status === "done");

  return {
    date: input.date,
    completed: {
      tasks: completed.length,
      points: completed.reduce((total, task) => total + task.points, 0),
    },
    pending,
    nextDays: [1, 2, 3].map((offset) => {
      const date = nextDate(input.date, offset);
      const capacity = resolveCapacity(input.db, input.profile, date);
      return { date, availableMinutes: capacity.availableMinutes, warnings: capacity.warnings };
    }),
  };
}
