import { z } from "zod";

export const taskStatusSchema = z.enum(["pending", "done", "dropped"]);
export const taskWeightSchema = z.enum(["S", "M", "L"]);
export const completionModeSchema = z.enum(["full", "floor"]);
export const agentStyleSchema = z.enum(["direct", "conversational"]);

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

export const agendaItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  energy: z.enum(["deep", "shallow"]).nullable(),
});

export const dayResponseSchema = z.object({
  date: z.string(),
  agenda: z.array(agendaItemSchema),
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

export const projectDocumentSchema = z.object({
  id: z.string(),
  type: z.enum(["spec", "approach"]),
  content: z.string(),
  summary: z.string().nullable(),
});

export const projectDetailSchema = z.object({
  project: projectSchema,
  documents: z.array(projectDocumentSchema),
  progress: z.object({
    completedPoints: z.number(),
    pendingPoints: z.number(),
    completedTasks: z.number(),
    pendingTasks: z.number(),
  }),
  warnings: z.array(z.string()),
});

export const scheduleBlockSchema = z.object({
  id: z.string(),
  label: z.string(),
  dayOfWeek: z.number(),
  startTime: z.string(),
  endTime: z.string(),
  state: z.enum(["busy", "free", "porous"]),
  energy: z.enum(["deep", "shallow"]).nullable(),
  source: z.enum(["inferred", "asked", "learned", "explicit"]),
  validFrom: z.string(),
  validUntil: z.string().nullable(),
});

export const scheduleResponseSchema = z.object({
  asOf: z.string(),
  blocks: z.array(scheduleBlockSchema),
});

export const profileSchema = z.object({
  id: z.string(),
  email: z.string(),
  timezone: z.string(),
  dayStart: z.string(),
  dayEnd: z.string(),
  agentStyle: agentStyleSchema,
});

export type Task = z.infer<typeof taskSchema>;
export type DayHabit = z.infer<typeof dayHabitSchema>;
export type AgendaItem = z.infer<typeof agendaItemSchema>;
export type DayResponse = z.infer<typeof dayResponseSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectDocument = z.infer<typeof projectDocumentSchema>;
export type ProjectDetail = z.infer<typeof projectDetailSchema>;
export type ScheduleBlock = z.infer<typeof scheduleBlockSchema>;
export type ScheduleResponse = z.infer<typeof scheduleResponseSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type AgentStyle = z.infer<typeof agentStyleSchema>;
