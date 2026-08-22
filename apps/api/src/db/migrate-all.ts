import { readdirSync } from "node:fs";
import { join } from "node:path";
import { getSystemDb } from "./system.ts";
import { getUserDb } from "./user.ts";
import { dataDir } from "./system.ts";

const system = await getSystemDb();
const usersDirectory = join(dataDir(), "users");
const userFiles = readdirSync(usersDirectory).filter((name) => name.endsWith(".db"));

for (const file of userFiles) {
  const userId = file.slice(0, -3);
  await getUserDb(userId);
  process.stdout.write(`migrated ${userId}\n`);
}

const systemVersion = system.query<{ version: number }, []>(
  `SELECT version FROM schema_versions WHERE db_kind = 'system' AND identifier = 'system'`,
).get();

process.stdout.write(`system version ${systemVersion?.version ?? 0}\n`);
