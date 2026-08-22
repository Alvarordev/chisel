import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { config } from "../config.ts";
import { getUserProfile, ensureUser } from "../db/system.ts";
import { getUserDb } from "../db/user.ts";
import type { ActorContext, AgentClient } from "../core/context.ts";
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
  getDay,
  rescheduleTask,
  taskDraftSchema,
} from "../core/tasks/service.ts";
import { PLANNING_CONTRACT } from "./contract.ts";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const taskPlanSchema = z.object({
  date: dateSchema,
  tasks: z.array(taskDraftSchema).min(1),
});

function agentClientFromRequest(request: Request | undefined): AgentClient {
  const userAgent = request?.headers.get("user-agent")?.toLowerCase() ?? "";
  if (userAgent.includes("claude")) return "claude";
  if (userAgent.includes("chatgpt")) return "chatgpt";
  if (userAgent.includes("gemini")) return "gemini";
  return null;
}

function actorFromRequest(request: Request | undefined): ActorContext {
  return {
    userId: config.DEV_USER_ID,
    source: "agent",
    agentClient: agentClientFromRequest(request),
  };
}

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function createPlannerServer(actor: ActorContext, db: Awaited<ReturnType<typeof getUserDb>>) {
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
    async ({ date }) => jsonResult(resolveCapacity(db, await getUserProfile(actor.userId), date)),
  );

  server.registerTool(
    "get_day",
    {
      title: "Get day",
      description: "Read project tasks and deterministically injected habits for a date.",
      inputSchema: z.object({ date: dateSchema }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ date }) => jsonResult(getDay(db, date)),
  );

  server.registerTool(
    "close_day",
    {
      title: "Close day",
      description: "Summarize completed project points, show pending tasks, and offer the next three days without forcing rescheduling.",
      inputSchema: z.object({ date: dateSchema }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ date }) => jsonResult(closeDay({ db, profile: await getUserProfile(actor.userId), date })),
  );

  server.registerTool(
    "propose_tasks",
    {
      title: "Propose tasks",
      description: `Validate a non-persisted plan against project context and capacity. The calling agent supplies the task decomposition; this server does not generate technical solutions.\n\n${PLANNING_CONTRACT}`,
      inputSchema: z.object({
        date: dateSchema,
        projectId: z.string().min(1).optional(),
        intent: z.string().trim().min(1).optional(),
        tasks: z.array(taskDraftSchema).min(1),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ date, projectId, intent, tasks }) =>
      jsonResult(proposeTasks({ db, profile: await getUserProfile(actor.userId), date, projectId, intent, tasks })),
  );

  server.registerTool(
    "create_tasks",
    {
      title: "Create tasks",
      description: `Persist the supplied task plan and always return created tasks plus warnings. Never reject solely because capacity is exceeded. The calling agent supplies the task decomposition.\n\n${PLANNING_CONTRACT}`,
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
      description: "Create a new effective-dated weekly capacity template without deleting historical blocks.",
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
      description: "Drop a project task while preserving its append-only event history.",
      inputSchema: z.object({ taskId: z.string().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ taskId }) => jsonResult(dropTask(db, actor, taskId)),
  );

  server.registerResource(
    "planning-contract",
    "planning-contract://current",
    { title: "Planning contract", description: "Rules the planner must follow", mimeType: "text/plain" },
    async (uri) => ({ contents: [{ uri: uri.href, text: PLANNING_CONTRACT, mimeType: "text/plain" }] }),
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
            text: `Planificá ${date ?? "hoy"}. Primero leé planning-contract, list_projects, get_project_context, get_capacity y get_day. Después usá propose_tasks sin persistir hasta que el usuario confirme.`,
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

export const mcpHandler = createMcpHandler(
  async (ctx) => {
    const actor = actorFromRequest(ctx.requestInfo);
    await ensureUser({ id: actor.userId });
    const db = await getUserDb(actor.userId);
    return createPlannerServer(actor, db);
  },
  { legacy: "stateless", responseMode: "json" },
);
