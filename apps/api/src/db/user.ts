import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { applyMigrations, databaseRegistry, migrationDirectory } from "./migrator.ts";
import { applyPragmas } from "./pragmas.ts";
import { dataDir, getSystemDb } from "./system.ts";

type PooledConnection = {
  db: Database;
  lastUsed: number;
};

const pool = new Map<string, PooledConnection>();
const evictionMs = 30 * 60 * 1000;

function evictIdleConnections(now: number): void {
  for (const [userId, connection] of pool) {
    if (now - connection.lastUsed > evictionMs) {
      connection.db.close();
      pool.delete(userId);
    }
  }
}

function closePooledUserDb(userId: string): void {
  const existing = pool.get(userId);
  if (!existing) return;
  existing.db.close();
  pool.delete(userId);
}

export async function getUserDb(userId: string): Promise<Database> {
  if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
    throw new Error("Invalid user id");
  }

  const now = Date.now();
  evictIdleConnections(now);
  const existing = pool.get(userId);

  if (existing) {
    existing.lastUsed = now;
    return existing.db;
  }

  const db = new Database(join(dataDir(), "users", `${userId}.db`));
  applyPragmas(db);
  const system = await getSystemDb();

  await applyMigrations({
    db,
    directory: migrationDirectory("user"),
    kind: "user",
    identifier: userId,
    registry: databaseRegistry(system),
  });

  pool.set(userId, { db, lastUsed: now });
  return db;
}

/** Wipe planner data for a user and recreate an empty user database. Keeps the auth account. */
export async function resetUserData(userId: string): Promise<void> {
  if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
    throw new Error("Invalid user id");
  }

  closePooledUserDb(userId);

  const root = dataDir();
  const userDbPath = join(root, "users", `${userId}.db`);
  for (const path of [userDbPath, `${userDbPath}-wal`, `${userDbPath}-shm`]) {
    if (existsSync(path)) rmSync(path, { force: true });
  }
  for (const relative of [`originals/${userId}`, `previews/${userId}`]) {
    const path = join(root, relative);
    if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  }

  const system = await getSystemDb();
  system.query(`DELETE FROM schema_versions WHERE db_kind = 'user' AND identifier = ?`).run(userId);
  system
    .query(
      `
        UPDATE users
        SET timezone = 'UTC', day_start = '07:00', day_end = '23:00', agent_style = 'direct'
        WHERE id = ?
      `,
    )
    .run(userId);

  await getUserDb(userId);
}

export function closeUserDbs(): void {
  for (const connection of pool.values()) {
    connection.db.close();
  }
  pool.clear();
}

export function resetUserDbPoolForTests(): void {
  closeUserDbs();
}
