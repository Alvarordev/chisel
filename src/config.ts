import { z } from "zod";

const envSchema = z.object({
  DATA_DIR: z.string().min(1).default("./data"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DEV_USER_ID: z.string().min(1).default("local-dev-user"),
  MCP_RESOURCE: z.url().default("http://127.0.0.1:3000/mcp"),
  MCP_PROTOCOL_VERSION: z.string().min(1).default("2026-07-28"),
  ALLOWED_HOSTS: z.string().default("127.0.0.1,localhost"),
  ALLOWED_ORIGIN_HOSTS: z.string().default("127.0.0.1,localhost"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment: ${parsed.error.message}`);
}

export const config = parsed.data;

export type Config = typeof config;
