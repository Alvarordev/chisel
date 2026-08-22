import { z } from "zod";

export const taskStatusSchema = z.enum(["pending", "done", "dropped"]);
export const taskWeightSchema = z.enum(["S", "M", "L"]);
export const completionModeSchema = z.enum(["full", "floor"]);

export const taskSchema = z.object({
  id: z.string(),
  kind: z.enum(["atomic", "batch", "habit"]),
  action: z.string(),
  doneWhen: z.string(),
  weight: taskWeightSchema,
  scheduledFor: z.string(),
  block: z.string().nullable(),
  projectId: z.string().nullable(),
  habitId: z.string().nullable(),
  status: taskStatusSchema,
  blockedBy: z.string().nullable(),
  dueTime: z.string().nullable(),
  completionMode: completionModeSchema.nullable(),
  completedAt: z.string().nullable(),
  points: z.number(),
  estimatedMinutes: z.number(),
  items: z.array(z.object({
    id: z.string(),
    label: z.string(),
    done: z.boolean(),
    completedAt: z.string().nullable(),
  })).optional(),
});

export const dayHabitSchema = z.object({
  id: z.string(),
  action: z.string(),
  fullDesc: z.string(),
  habitFloor: z.string(),
  fullMinutes: z.number(),
  floorMinutes: z.number(),
  schedule: z.array(z.number()),
  blockHint: z.enum(["morning", "afternoon", "evening"]).nullable(),
  scheduledFor: z.string(),
  taskId: z.string(),
  kind: z.literal("habit"),
  doneWhen: z.string(),
  status: taskStatusSchema,
  completionMode: completionModeSchema.nullable(),
  isVirtual: z.boolean(),
  estimatedMinutes: z.number(),
});

export const dayResponseSchema = z.object({
  date: z.string(),
  tasks: z.array(taskSchema),
  habits: z.array(dayHabitSchema),
});

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["build", "study"]),
  deadline: z.string().nullable(),
  status: z.enum(["active", "archived"]),
  createdAt: z.string(),
  pendingTasks: z.number(),
  completedTasks: z.number(),
});

export const profileSchema = z.object({
  id: z.string(),
  email: z.string(),
  timezone: z.string(),
  dayStart: z.string(),
  dayEnd: z.string(),
});

export type Task = z.infer<typeof taskSchema>;
export type DayHabit = z.infer<typeof dayHabitSchema>;
export type DayResponse = z.infer<typeof dayResponseSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Profile = z.infer<typeof profileSchema>;
