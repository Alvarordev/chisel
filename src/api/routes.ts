import { Hono } from "hono";
import { z } from "zod";
import { config } from "../config.ts";
import { getUserProfile, ensureUser } from "../db/system.ts";
import { getUserDb } from "../db/user.ts";
import { getDay, completeTask } from "../core/tasks/service.ts";
import { listProjects, createProject, projectKindSchema } from "../core/projects/service.ts";
import type { ActorContext } from "../core/context.ts";

const actor: ActorContext = { userId: config.DEV_USER_ID, source: "web", agentClient: null };

async function userDb() {
  await ensureUser({ id: actor.userId });
  return getUserDb(actor.userId);
}

export const apiRoutes = new Hono();

apiRoutes.get("/day/:date", async (c) => {
  const db = await userDb();
  return c.json(getDay(db, c.req.param("date")));
});

apiRoutes.post("/tasks/:id/complete", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = z
    .object({ completionMode: z.enum(["full", "floor"]).optional(), itemIds: z.array(z.string()).optional() })
    .parse(body);
  const db = await userDb();
  return c.json(completeTask(db, actor, { taskId: c.req.param("id"), ...parsed }));
});

apiRoutes.get("/projects", async (c) => {
  const db = await userDb();
  return c.json(listProjects(db, c.req.query("status") === "archived" ? "archived" : "active"));
});

apiRoutes.post("/projects", async (c) => {
  const body = await c.req.json();
  const parsed = z
    .object({ name: z.string().trim().min(1), kind: projectKindSchema, deadline: z.string().nullable().optional() })
    .parse(body);
  const db = await userDb();
  return c.json(createProject(db, parsed), 201);
});

apiRoutes.get("/profile", async (c) => c.json(await getUserProfile(actor.userId)));
