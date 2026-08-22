import type { Database } from "bun:sqlite";
import { getProjectContext } from "../projects/service.ts";
import { resolveCapacity } from "../capacity/resolve.ts";
import type { UserProfile } from "../../db/system.ts";
import { taskDraftSchema, type TaskDraft } from "../tasks/service.ts";

export function proposeTasks(input: {
  db: Database;
  profile: UserProfile;
  date: string;
  projectId?: string;
  intent?: string;
  tasks: TaskDraft[];
}): {
  date: string;
  tasks: TaskDraft[];
  totalPoints: number;
  totalMinutes: number;
  capacityMinutes: number;
  warnings: string[];
} {
  const tasks = input.tasks.map((task) => taskDraftSchema.parse(task));
  const capacity = resolveCapacity(input.db, input.profile, input.date);
  const warnings = [...capacity.warnings];

  if (input.projectId) {
    getProjectContext(input.db, input.projectId);
    if (tasks.some((task) => task.projectId && task.projectId !== input.projectId)) {
      warnings.push("El plan mezcla el proyecto solicitado con otros proyectos");
    }
  }

  const totalMinutes = tasks.reduce((total, task) => {
    const minutes = task.kind === "batch" ? minutesForBatch(task) : weightMinutes(task.weight);
    return total + minutes;
  }, 0);
  const totalPoints = tasks.reduce((total, task) => total + weightPoints(task.weight), 0);

  if (totalMinutes > capacity.availableMinutes) {
    warnings.push(
      `El plan usa ${totalMinutes} minutos para ${capacity.availableMinutes} minutos disponibles; se registra igual si se confirma`,
    );
  }
  if (tasks.filter((task) => task.weight === "L").length > 1) {
    warnings.push("Más de una tarea L en el día");
  }

  return {
    date: input.date,
    tasks,
    totalPoints,
    totalMinutes,
    capacityMinutes: capacity.availableMinutes,
    warnings,
  };
}

function weightMinutes(weight: TaskDraft["weight"]): number {
  return weight === "S" ? 15 : weight === "M" ? 45 : 120;
}

function weightPoints(weight: TaskDraft["weight"]): number {
  return weight === "S" ? 1 : weight === "M" ? 2 : 4;
}

function minutesForBatch(task: TaskDraft): number {
  const base = weightMinutes(task.weight);
  const itemCount = task.items?.length ?? 0;
  return itemCount > 0 ? Math.round(base * (1 + Math.max(0, itemCount - 1) * 0.3)) : base;
}
