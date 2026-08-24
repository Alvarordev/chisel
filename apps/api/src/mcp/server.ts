import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { getUserProfile, ensureUser } from "../db/system.ts";
import { getUserDb } from "../db/user.ts";
import type { ActorContext } from "../core/context.ts";
import { actorFromMcpAuth } from "../auth/actors.ts";
import {
  blockAttributeSchema,
  createException,
  exceptionInputSchema,
  scheduleInputSchema,
  setBlockAttribute,
  setSchedule,
  addProjectNote,
} from "../core/capacity/configure.ts";
import { resolveCapacity } from "../core/capacity/resolve.ts";
import { createHabit, habitInputSchema } from "../core/habits/service.ts";
import { closeDay } from "../core/planning/close-day.ts";
import { proposeTasks } from "../core/planning/propose.ts";
import {
  createProject,
  getProjectContext,
  listProjects,
  projectKindSchema,
  setDocument,
} from "../core/projects/service.ts";
import {
  completeTask,
  createTasks,
  dropTask,
  dropTasks,
  getDay,
  rescheduleTask,
  taskDraftSchema,
} from "../core/tasks/service.ts";
import { buildPlanTodayPrompt, buildPlanningContract } from "./contract.ts";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const taskPlanSchema = z.object({
  date: dateSchema,
  tasks: z.array(taskDraftSchema).min(1),
});

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

async function createPlannerServer(actor: ActorContext, db: Awaited<ReturnType<typeof getUserDb>>) {
  const profile = await getUserProfile(actor.userId);
  const contract = buildPlanningContract(profile.agentStyle);

  const server = new McpServer({
    name: "chisel-planner",
    version: "0.1.0",
  });

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "List active or archived projects with derived task counts.",
      inputSchema: z.object({ status: z.enum(["active", "archived"]).optional() }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ status }) => jsonResult(listProjects(db, status)),
  );

  server.registerTool(
    "get_project_context",
    {
      title: "Get project context",
      description: "Read a project's spec, approach, notes, and derived progress before planning.",
      inputSchema: z.object({
        projectId: z.string().min(1),
        maxLength: z.number().int().positive().max(100_000).optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ projectId, maxLength }) => jsonResult(getProjectContext(db, projectId, maxLength)),
  );

  server.registerTool(
    "get_capacity",
    {
      title: "Get resolved capacity",
      description: "Resolve schedule, exceptions, inferred gaps, habit reservations, and available minutes.",
      inputSchema: z.object({ date: dateSchema }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ date }) => jsonResult(resolveCapacity(db, profile, date)),
  );

  server.registerTool(
    "get_day",
    {
      title: "Get day",
      description: "Read active project tasks (pending and done; dropped are excluded), injected habits, and read-only busy agenda commitments for a date. Agenda items are not tasks. Always call after create_tasks to verify persistence.",
      inputSchema: z.object({ date: dateSchema }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ date }) => jsonResult(getDay(db, date, profile)),
  );

  server.registerTool(
    "close_day",
    {
      title: "Close day",
      description: "Summarize completed project points, show pending tasks, and offer the next three days without forcing rescheduling.",
      inputSchema: z.object({ date: dateSchema }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ date }) => jsonResult(closeDay({ db, profile, date })),
  );

  server.registerTool(
    "propose_tasks",
    {
      title: "Propose tasks",
      description: `Validate a non-persisted plan against project context and capacity. The calling agent supplies the task decomposition; this server does not generate technical solutions.\n\n${contract}`,
      inputSchema: z.object({
        date: dateSchema,
        projectId: z.string().min(1).optional(),
        intent: z.string().trim().min(1).optional(),
        tasks: z.array(taskDraftSchema).min(1),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ date, projectId, intent, tasks }) =>
      jsonResult(proposeTasks({ db, profile, date, projectId, intent, tasks })),
  );

  server.registerTool(
    "create_tasks",
    {
      title: "Create tasks",
      description: `Persist the supplied task plan and always return created tasks plus warnings. Never reject solely because capacity is exceeded. After calling this, you MUST call get_day(date) to verify what was persisted before telling the user.\n\n${contract}`,
      inputSchema: taskPlanSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ date, tasks }) => jsonResult(createTasks(db, actor, { date, tasks })),
  );

  server.registerTool(
    "create_project",
    {
      title: "Create project",
      description: "Create an active build or study project.",
      inputSchema: z.object({
        name: z.string().trim().min(1),
        kind: projectKindSchema,
        deadline: dateSchema.nullable().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => jsonResult(createProject(db, input)),
  );

  server.registerTool(
    "set_document",
    {
      title: "Set project document",
      description: "Create or replace a project's spec or approach document in markdown.",
      inputSchema: z.object({
        projectId: z.string().min(1),
        type: z.enum(["spec", "approach"]),
        content: z.string().min(1),
        summary: z.string().nullable().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ projectId, type, content, summary }) =>
      jsonResult(setDocument(db, { projectId, type, content, summary, source: "agent" })),
  );

  server.registerTool(
    "create_habit",
    {
      title: "Create habit",
      description: "Create a scheduled habit with a full action and a smaller floor action.",
      inputSchema: habitInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => jsonResult(createHabit(db, input)),
  );

  server.registerTool(
    "set_schedule",
    {
      title: "Set weekly schedule",
      description: "Create a new effective-dated weekly capacity block without closing other commitments. Each block may include validFrom and validUntil.",
      inputSchema: scheduleInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => jsonResult(setSchedule(db, input)),
  );

  server.registerTool(
    "create_exception",
    {
      title: "Create capacity exception",
      description: "Cancel, replace, or add a one-off capacity block for a date.",
      inputSchema: exceptionInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => jsonResult(createException(db, input)),
  );

  server.registerTool(
    "set_block_attribute",
    {
      title: "Set block attribute",
      description: "Set a block's state or energy and promote its source to asked or explicit.",
      inputSchema: blockAttributeSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => jsonResult(setBlockAttribute(db, input)),
  );

  server.registerTool(
    "add_note",
    {
      title: "Add project note",
      description: "Append a note to a project without replacing its spec or approach.",
      inputSchema: z.object({ projectId: z.string().min(1), content: z.string().trim().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ projectId, content }) => jsonResult(addProjectNote(db, { projectId, content, source: actor.source })),
  );

  server.registerTool(
    "complete_task",
    {
      title: "Complete task",
      description: "Complete an atomic task, finish batch items, or complete a habit in full or floor mode.",
      inputSchema: z.object({
        taskId: z.string().min(1),
        completionMode: z.enum(["full", "floor"]).optional(),
        itemIds: z.array(z.string().min(1)).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => jsonResult(completeTask(db, actor, input)),
  );

  server.registerTool(
    "reschedule",
    {
      title: "Reschedule task",
      description: "Move a project task to another date without blocking the operation on capacity.",
      inputSchema: z.object({ taskId: z.string().min(1), date: dateSchema, block: z.string().nullable().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ taskId, date, block }) => jsonResult(rescheduleTask(db, actor, { taskId, date, block })),
  );

  server.registerTool(
    "drop_task",
    {
      title: "Drop task",
      description: "Remove a task from the active plan (soft drop). Not a failure. Use when the user changes their mind. Dropped tasks no longer appear in get_day.",
      inputSchema: z.object({ taskId: z.string().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ taskId }) => jsonResult(dropTask(db, actor, taskId)),
  );

  server.registerTool(
    "drop_tasks",
    {
      title: "Drop tasks",
      description: "Drop multiple tasks at once. Provide taskIds, or date + pendingOnly to clear all pending project tasks for that day. Use before create_tasks when replacing the plan.",
      inputSchema: z.object({
        taskIds: z.array(z.string().min(1)).optional(),
        date: dateSchema.optional(),
        pendingOnly: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (input) => jsonResult(dropTasks(db, actor, input)),
  );

  server.registerResource(
    "planning-contract",
    "planning-contract://current",
    { title: "Planning contract", description: "Rules the planner must follow", mimeType: "text/plain" },
    async (uri) => ({ contents: [{ uri: uri.href, text: contract, mimeType: "text/plain" }] }),
  );

  server.registerPrompt(
    "plan_today",
    {
      title: "Plan today",
      description: "Read context and capacity, then propose the smallest useful plan for today.",
      argsSchema: z.object({ date: dateSchema.optional() }),
    },
    ({ date }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: buildPlanTodayPrompt(profile.agentStyle, date),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "close_day",
    {
      title: "Close day",
      description: "Run the two-minute closing ritual without creating guilt or forcing a decision.",
      argsSchema: z.object({ date: dateSchema.optional() }),
    },
    ({ date }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Cerrá ${date ?? "hoy"}. Leé get_day y close_day, reconocé el avance y ofrecé reprogramar pendientes solo si el usuario lo decide.`,
          },
        },
      ],
    }),
  );

  return server;
}

export const plannerMcpHandler = createMcpHandler(
  async ({ authInfo, requestInfo }) => {
    if (!authInfo || !requestInfo) {
      throw new Error("MCP request is missing verified authentication");
    }

    const actor = await actorFromMcpAuth(authInfo, requestInfo);
    await ensureUser({ id: actor.userId });
    const db = await getUserDb(actor.userId);
    return createPlannerServer(actor, db);
  },
  { legacy: "stateless", responseMode: "json" },
);
