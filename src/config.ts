import { z } from "zod";

const envSchema = z.object({
  DATA_DIR: z.string().min(1).default("./data"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DEV_USER_ID: z.string().min(1).default("local-dev-user"),
  AUTH_BASE_URL: z.url().default("http://127.0.0.1:3000"),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  MCP_RESOURCE: z.url().default("http://127.0.0.1:3000/mcp"),
  MCP_PROTOCOL_VERSION: z.string().min(1).default("2026-07-28"),
  ALLOWED_HOSTS: z.string().default("127.0.0.1,localhost"),
  ALLOWED_ORIGIN_HOSTS: z.string().default("127.0.0.1,localhost"),
  TRUSTED_ORIGINS: z.string().default("http://127.0.0.1:3000,http://localhost:3000"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment: ${parsed.error.message}`);
}

export const config = parsed.data;

export function csv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export const trustedOrigins = csv(config.TRUSTED_ORIGINS);

export type Config = typeof config;
