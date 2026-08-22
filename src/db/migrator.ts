import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Database, SQLQueryBindings } from "bun:sqlite";

type MigrationKind = "system" | "user";

type MigrationRegistry = {
  run: (statement: string, ...params: SQLQueryBindings[]) => unknown;
  get: <T = unknown>(statement: string, ...params: SQLQueryBindings[]) => T | null;
};

type Migration = {
  version: number;
  name: string;
  sql: string;
};

async function loadMigrations(directory: string): Promise<Migration[]> {
  const names = readdirSync(directory)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();

  return Promise.all(
    names.map(async (name) => ({
      version: Number(name.split("_", 1)[0]),
      name,
      sql: await Bun.file(join(directory, name)).text(),
    })),
  );
}

function currentUserVersion(db: Database): number {
  const row = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
  return row?.user_version ?? 0;
}

function setUserVersion(db: Database, version: number): void {
  db.exec(`PRAGMA user_version = ${version}`);
}

export async function applyMigrations(options: {
  db: Database;
  directory: string;
  kind: MigrationKind;
  identifier: string;
  registry: MigrationRegistry;
}): Promise<number> {
  const migrations = await loadMigrations(options.directory);
  let version = currentUserVersion(options.db);

  for (const migration of migrations) {
    const registryRow =
      version === 0 && options.kind === "system"
        ? null
        : options.registry.get<{ version: number }>(
            `SELECT version FROM schema_versions WHERE db_kind = ? AND identifier = ?`,
            options.kind,
            options.identifier,
          );

    if (migration.version <= version) {
      if (!registryRow || registryRow.version < migration.version) {
        options.registry.run(
          `
            INSERT INTO schema_versions (db_kind, identifier, version, applied_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (db_kind, identifier)
            DO UPDATE SET version = excluded.version, applied_at = excluded.applied_at
          `,
          options.kind,
          options.identifier,
          migration.version,
          new Date().toISOString(),
        );
      }
      continue;
    }

    if (migration.version !== version + 1) {
      throw new Error(
        `Migration gap for ${options.kind}/${options.identifier}: expected ${version + 1}, found ${migration.version}`,
      );
    }

    options.db.transaction(() => {
      options.db.exec(migration.sql);
      setUserVersion(options.db, migration.version);
    })();

    options.registry.run(
      `
        INSERT INTO schema_versions (db_kind, identifier, version, applied_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (db_kind, identifier)
        DO UPDATE SET version = excluded.version, applied_at = excluded.applied_at
      `,
      options.kind,
      options.identifier,
      migration.version,
      new Date().toISOString(),
    );

    version = migration.version;
  }

  return version;
}

export function migrationDirectory(kind: MigrationKind): string {
  return join(import.meta.dir, "migrations", kind);
}

export function databaseRegistry(db: Database): MigrationRegistry {
  return {
    run: (statement, ...params) => db.query(statement).run(...params),
    get: <T>(statement: string, ...params: SQLQueryBindings[]) =>
      db.query<T, SQLQueryBindings[]>(statement).get(...params) ?? null,
  };
}
