import { mcp } from "@better-auth/mcp";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { config, trustedOrigins } from "../config.ts";
import { ensureUser, openSystemDb } from "../db/system.ts";

const localSecret = "chisel-local-development-secret-change-me";

if (process.env.NODE_ENV === "production" && !config.BETTER_AUTH_SECRET) {
  throw new Error("BETTER_AUTH_SECRET is required in production");
}

const secret = config.BETTER_AUTH_SECRET ?? localSecret;

export const auth = betterAuth({
  appName: "Chisel Planner",
  baseURL: config.AUTH_BASE_URL,
  basePath: "/api/auth",
  secret,
  database: openSystemDb(),
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
  },
  session: {
    storeSessionInDatabase: true,
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    storage: "memory",
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await ensureUser({ id: user.id, email: user.email });
        },
      },
      update: {
        after: async (user) => {
          await ensureUser({ id: user.id, email: user.email });
        },
      },
    },
  },
  plugins: [
    jwt(),
    mcp({
      loginPage: "/login",
      consentPage: "/consent",
      resource: config.MCP_RESOURCE,
      scopes: ["openid", "profile", "email", "offline_access", "mcp:tools"],
      grantTypes: ["authorization_code", "refresh_token"],
      accessTokenExpiresIn: 60 * 60,
      refreshTokenExpiresIn: 60 * 60 * 24 * 30,
      codeExpiresIn: 600,
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
    }),
  ],
});

let authSchemaPromise: Promise<void> | undefined;

export function ensureAuthSchema(): Promise<void> {
  authSchemaPromise ??= (async () => {
    await auth.$context;
  })();
  return authSchemaPromise;
}
