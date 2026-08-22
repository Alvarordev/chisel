import { Hono } from "hono";
import { z } from "zod";
import { getUserProfile, ensureUser } from "../db/system.ts";
import { getUserDb } from "../db/user.ts";
import { getDay, completeTask } from "../core/tasks/service.ts";
import { listProjects, createProject, projectKindSchema } from "../core/projects/service.ts";
import { actorFromSession } from "../auth/actors.ts";

export const apiRoutes = new Hono();

apiRoutes.get("/day/:date", async (c) => {
  const actor = await actorFromSession(c.req.raw, "web");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  await ensureUser({ id: actor.userId });
  const db = await getUserDb(actor.userId);
  return c.json(getDay(db, c.req.param("date")));
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

apiRoutes.get("/profile", async (c) => {
  const actor = await actorFromSession(c.req.raw, "web");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  return c.json(await getUserProfile(actor.userId));
});
