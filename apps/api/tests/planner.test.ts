import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "chisel-test-"));

const { ensureUser, getUserProfile } = await import("../src/db/system.ts");
const { getUserDb, resetUserDbPoolForTests } = await import("../src/db/user.ts");
const { createHabit, habitsForDay } = await import("../src/core/habits/service.ts");
const { resolveCapacity } = await import("../src/core/capacity/resolve.ts");
const { createProject, getProjectContext } = await import("../src/core/projects/service.ts");
const { completeTask, createTasks, dropTask, dropTasks, getDay } = await import("../src/core/tasks/service.ts");

const actor = { userId: "test-user", source: "agent" as const, agentClient: "claude" as const };

test("migrates a user database and derives project progress", async () => {
  await ensureUser({ id: actor.userId, timezone: "UTC" });
  const db = await getUserDb(actor.userId);
  const project = createProject(db, { name: "MVP", kind: "build" });

  const created = createTasks(db, actor, {
    date: "2026-08-24",
    tasks: [
      {
        kind: "atomic",
        action: "Crear el endpoint de salud",
        doneWhen: "GET /health devuelve { ok: true }",
        weight: "S",
        projectId: project.id,
      },
    ],
  });

  expect(created.created).toHaveLength(1);
  expect(created.totalPoints).toBe(1);
  expect(created.totalMinutes).toBe(15);

  const pending = getProjectContext(db, project.id);
  expect(pending.progress).toEqual({
    completedPoints: 0,
    pendingPoints: 1,
    completedTasks: 0,
    pendingTasks: 1,
  });

  completeTask(db, actor, { taskId: created.created[0]!.id });
  const completed = getProjectContext(db, project.id);
  expect(completed.progress.completedPoints).toBe(1);
  expect(completed.progress.pendingPoints).toBe(0);
});

test("injects habits virtually and records floor completion only on mutation", async () => {
  const db = await getUserDb(actor.userId);
  createHabit(db, {
    action: "Mover el cuerpo",
    fullDesc: "Hacer una rutina completa de movilidad",
    habitFloor: "Hacer cinco minutos de movilidad",
    fullMinutes: 30,
    floorMinutes: 5,
    schedule: [6],
    blockHint: "morning",
  });

  const before = getDay(db, "2026-08-22");
  expect(before.habits).toHaveLength(1);
  expect(before.habits[0]!.isVirtual).toBe(true);
  expect(before.habits[0]!.completionMode).toBeNull();

  const completed = completeTask(db, actor, {
    taskId: before.habits[0]!.taskId,
    completionMode: "floor",
  });
  expect(completed.kind).toBe("habit");
  expect(completed.completionMode).toBe("floor");

  const after = getDay(db, "2026-08-22");
  expect(after.habits[0]!.isVirtual).toBe(false);
  expect(after.habits[0]!.status).toBe("done");
  expect(after.habits[0]!.completionMode).toBe("floor");
});

test("capacity is expressed in minutes and preserves the completed habit mode", async () => {
  const db = await getUserDb(actor.userId);
  const profile = await getUserProfile(actor.userId);
  const capacity = resolveCapacity(db, profile, "2026-08-22");

  expect(capacity.availableMinutesBeforeHabits).toBeGreaterThan(0);
  expect(capacity.habitReservations[0]?.minutes).toBe(5);
  expect(capacity.availableMinutes).toBe(
    capacity.availableMinutesBeforeHabits - 5,
  );

  resetUserDbPoolForTests();
});

test("excludes dropped tasks from get_day and supports batch drop", async () => {
  const db = await getUserDb(actor.userId);
  const project = createProject(db, { name: "Drop test", kind: "build" });
  const created = createTasks(db, actor, {
    date: "2026-08-25",
    tasks: [
      {
        kind: "atomic",
        action: "Tarea A",
        doneWhen: "Hecho A",
        weight: "S",
        projectId: project.id,
      },
      {
        kind: "atomic",
        action: "Tarea B",
        doneWhen: "Hecho B",
        weight: "S",
        projectId: project.id,
      },
    ],
  });

  dropTask(db, actor, created.created[0]!.id);
  const day = getDay(db, "2026-08-25");
  expect(day.tasks).toHaveLength(1);
  expect(day.tasks[0]!.action).toBe("Tarea B");

  const cleared = dropTasks(db, actor, { date: "2026-08-25", pendingOnly: true });
  expect(cleared.dropped).toHaveLength(1);
  expect(getDay(db, "2026-08-25").tasks).toHaveLength(0);
});

test("stores agent style on user profile", async () => {
  const profile = await getUserProfile(actor.userId);
  expect(profile.agentStyle).toBe("direct");
});

test("challenges unauthenticated modern MCP requests", async () => {
  const { app } = await import("../src/index.ts");
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "server/discover",
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "bun-test", version: "0.1.0" },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };
  const response = await app.request("http://127.0.0.1:3000/mcp", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      "content-type": "application/json",
      accept: "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "server/discover",
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as { error?: { message?: string } };

  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain("resource_metadata");
  expect(result.error?.message).toContain("authorization");
});
