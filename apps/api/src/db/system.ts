import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { config } from "../config.ts";
import { applyMigrations, databaseRegistry, migrationDirectory } from "./migrator.ts";
import { applyPragmas } from "./pragmas.ts";

let systemDb: Database | undefined;

export type UserProfile = {
  id: string;
  email: string;
  timezone: string;
  dayStart: string;
  dayEnd: string;
};

function dataDirectory(): string {
  mkdirSync(config.DATA_DIR, { recursive: true });
  mkdirSync(join(config.DATA_DIR, "users"), { recursive: true });
  mkdirSync(join(config.DATA_DIR, "originals"), { recursive: true });
  return config.DATA_DIR;
}

export async function getSystemDb(): Promise<Database> {
  return openSystemDb();
}

export function openSystemDb(): Database {
  if (!systemDb) {
    systemDb = new Database(join(dataDirectory(), "system.db"));
    applyPragmas(systemDb);
    applyMigrations({
      db: systemDb,
      directory: migrationDirectory("system"),
      kind: "system",
      identifier: "system",
      registry: databaseRegistry(systemDb),
    });
  }

  return systemDb;
}

export async function ensureUser(input: {
  id: string;
  email?: string;
  passwordHash?: string;
  timezone?: string;
  dayStart?: string;
  dayEnd?: string;
}): Promise<void> {
  const db = await getSystemDb();
  const now = new Date().toISOString();
  const email = input.email ?? `${input.id}@local.invalid`;

  db.query(
    `
      INSERT INTO users (id, email, password_hash, timezone, day_start, day_end, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET email = excluded.email
    `,
  ).run(
    input.id,
    email,
    input.passwordHash ?? "",
    input.timezone ?? "UTC",
    input.dayStart ?? "07:00",
    input.dayEnd ?? "23:00",
    now,
  );
}

export async function getUserProfile(userId: string): Promise<UserProfile> {
  const db = await getSystemDb();
  const row = db
    .query<{
      id: string;
      email: string;
      timezone: string;
      day_start: string;
      day_end: string;
    }, [string]>(
      `SELECT id, email, timezone, day_start, day_end FROM users WHERE id = ?`,
    )
    .get(userId);

  if (!row) {
    throw new Error("User not found");
  }

  return {
    id: row.id,
    email: row.email,
    timezone: row.timezone,
    dayStart: row.day_start,
    dayEnd: row.day_end,
  };
}

export function dataDir(): string {
  return dataDirectory();
}
