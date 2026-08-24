import { Hono } from "hono";
import { z } from "zod";
import { getUserProfile, ensureUser, updateUserProfile } from "../db/system.ts";
import { getUserDb } from "../db/user.ts";
import { getDay, completeTask } from "../core/tasks/service.ts";
import {
  createProject,
  getProjectContext,
  listProjects,
  projectKindSchema,
  setDocument,
} from "../core/projects/service.ts";
import {
  closeScheduleBlock,
  createScheduleBlock,
  listSchedule,
  scheduleBlockUpdateSchema,
  scheduleBlockWriteSchema,
  updateScheduleBlock,
} from "../core/capacity/configure.ts";
import { actorFromSession } from "../auth/actors.ts";

export const apiRoutes = new Hono();

apiRoutes.get("/day/:date", async (c) => {
  const actor = await actorFromSession(c.req.raw, "web");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  await ensureUser({ id: actor.userId });
  const db = await getUserDb(actor.userId);
  const profile = await getUserProfile(actor.userId);
  return c.json(getDay(db, c.req.param("date"), profile));
});

apiRoutes.post("/tasks/:id/complete", async (c) => {
  const actor = await actorFromSession(c.req.raw, "web");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const parsed = z
    .object({ completionMode: z.enum(["full", "floor"]).optional(), itemIds: z.array(z.string()).optional() })
    .parse(body);
  await ensureUser({ id: actor.userId });
  const db = await getUserDb(actor.userId);
  return c.json(completeTask(db, actor, { taskId: c.req.param("id"), ...parsed }));
});

apiRoutes.get("/projects", async (c) => {
  const actor = await actorFromSession(c.req.raw, "web");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  await ensureUser({ id: actor.userId });
  const db = await getUserDb(actor.userId);
  return c.json(listProjects(db, c.req.query("status") === "archived" ? "archived" : "active"));
});

apiRoutes.post("/projects", async (c) => {
  const actor = await actorFromSession(c.req.raw, "web");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json();
  const parsed = z
    .object({ name: z.string().trim().min(1), kind: projectKindSchema, deadline: z.string().nullable().optional() })
    .parse(body);
  await ensureUser({ id: actor.userId });
  const db = await getUserDb(actor.userId);
  return c.json(createProject(db, parsed), 201);
});

apiRoutes.get("/projects/:id", async (c) => {
  const actor = await actorFromSession(c.req.raw, "web");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  await ensureUser({ id: actor.userId });
  const db = await getUserDb(actor.userId);
  try {
    const context = getProjectContext(db, c.req.param("id"));
    return c.json({
      project: context.project,
      documents: context.documents,
      progress: context.progress,
      warnings: context.warnings,
    });
  } catch {
    return c.json({ error: "Project not found" }, 404);
  }
});

apiRoutes.post("/projects/:id/documents", async (c) => {
  const actor = await actorFromSession(c.req.raw, "web");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json();
  const parsed = z
    .object({
      type: z.enum(["spec", "approach"]),
      content: z.string().min(1),
      summary: z.string().nullable().optional(),
    })
    .parse(body);
  await ensureUser({ id: actor.userId });
  const db = await getUserDb(actor.userId);
  try {
    const result = setDocument(db, {
      projectId: c.req.param("id"),
      type: parsed.type,
      content: parsed.content,
      summary: parsed.summary,
      source: "paste",
    });
    return c.json(result, 201);
  } catch {
    return c.json({ error: "Project not found" }, 404);
  }
});

apiRoutes.get("/schedule", async (c) => {
  const actor = await actorFromSession(c.req.raw, "web");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  await ensureUser({ id: actor.userId });
  const db = await getUserDb(actor.userId);
  const asOf = c.req.query("asOf");
  return c.json(listSchedule(db, asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : undefined));
});

apiRoutes.post("/schedule/blocks", async (c) => {
  const actor = await actorFromSession(c.req.raw, "web");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json();
  const parsed = scheduleBlockWriteSchema.parse(body);
  await ensureUser({ id: actor.userId });
  const db = await getUserDb(actor.userId);
  return c.json(createScheduleBlock(db, parsed), 201);
});

apiRoutes.patch("/schedule/blocks/:id", async (c) => {
  const actor = await actorFromSession(c.req.raw, "web");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json();
  const parsed = scheduleBlockUpdateSchema.parse(body);
  await ensureUser({ id: actor.userId });
  const db = await getUserDb(actor.userId);
  try {
    return c.json(updateScheduleBlock(db, c.req.param("id"), parsed));
  } catch {
    return c.json({ error: "Capacity block not found" }, 404);
  }
});

apiRoutes.delete("/schedule/blocks/:id", async (c) => {
  const actor = await actorFromSession(c.req.raw, "web");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  await ensureUser({ id: actor.userId });
  const db = await getUserDb(actor.userId);
  try {
    return c.json(closeScheduleBlock(db, c.req.param("id")));
  } catch {
    return c.json({ error: "Capacity block not found" }, 404);
  }
});

apiRoutes.get("/profile", async (c) => {
  const actor = await actorFromSession(c.req.raw, "web");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  return c.json(await getUserProfile(actor.userId));
});

apiRoutes.patch("/profile", async (c) => {
  const actor = await actorFromSession(c.req.raw, "web");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json();
  const parsed = z.object({ agentStyle: z.enum(["direct", "conversational"]).optional() }).parse(body);
  return c.json(await updateUserProfile(actor.userId, parsed));
});
