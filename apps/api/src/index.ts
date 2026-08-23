import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { requireMcpAuth } from "@better-auth/mcp";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import type { Context } from "hono";
import { logger } from "hono/logger";
import { config, csv, trustedOrigins } from "./config.ts";
import { apiRoutes } from "./api/routes.ts";
import { auth, ensureAuthSchema } from "./auth/index.ts";
import { authInfoFromClaims } from "./auth/actors.ts";
import { authUiRoutes } from "./auth/ui.ts";
import { plannerMcpHandler } from "./mcp/server.ts";

const webDistPath = new URL("../../web/dist/", import.meta.url).pathname;
const webIndexUrl = new URL("../../web/dist/index.html", import.meta.url);

const mcpAuthHandler = requireMcpAuth(
  auth,
  async (request, claims) => plannerMcpHandler.fetch(request, {
    authInfo: authInfoFromClaims(request, claims),
  }),
  {
    resource: config.MCP_RESOURCE,
    jwksUrl: config.MCP_JWKS_URL,
    requiredScopes: ["mcp:tools"],
    challengeScopes: ["mcp:tools"],
  },
);

async function authHandler(c: Context) {
  await ensureAuthSchema();
  return auth.handler(c.req.raw);
}

async function rootAuthServerMetadataHandler(c: Context) {
  await ensureAuthSchema();
  const request = new Request(new URL("/api/auth/.well-known/oauth-authorization-server", c.req.url), {
    method: c.req.method,
    headers: c.req.raw.headers,
  });
  return auth.handler(request);
}

async function webAppHandler(c: Context) {
  const file = Bun.file(webIndexUrl);
  if (!(await file.exists())) return c.json({ error: "Web build not found" }, 404);
  return c.body(await file.arrayBuffer(), 200, { "content-type": "text/html; charset=UTF-8" });
}

export function createApp() {
  const allowedHosts = [
    ...new Set([
      ...csv(config.ALLOWED_HOSTS),
      "127.0.0.1",
      "localhost",
    ]),
  ];
  const app = createMcpHonoApp({
    host: config.HOST,
    allowedHosts,
    allowedOrigins: csv(config.ALLOWED_ORIGIN_HOSTS),
  });

  app.use("/api/*", logger());
  app.use("/mcp", logger());
  app.use("/api/*", cors({ origin: trustedOrigins, credentials: true }));
  app.use("/.well-known/*", cors({ origin: trustedOrigins, credentials: true }));

  app.get("/health", (c) =>
    c.json({ ok: true, service: "chisel-planner", protocol: config.MCP_PROTOCOL_VERSION }),
  );
  app.route("/", authUiRoutes);
  app.all("/api/auth/*", authHandler);
  app.all("/.well-known/oauth-authorization-server", rootAuthServerMetadataHandler);
  app.all("/.well-known/oauth-protected-resource", authHandler);
  app.all("/.well-known/oauth-protected-resource/*", authHandler);
  app.route("/api", apiRoutes);
  app.all("/mcp", async (c) => {
    await ensureAuthSchema();
    return mcpAuthHandler(c.req.raw);
  });
  app.get("/", (c) => c.redirect("/app/today"));
  app.get("/app", webAppHandler);
  app.get("/app/*", webAppHandler);
  app.use("/assets/*", serveStatic({ root: webDistPath }));

  app.notFound((c) => c.json({ error: "Not found" }, 404));
  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: "Internal server error" }, 500);
  });

  return app;
}

export const app = createApp();

if (import.meta.main) {
  Bun.serve({
    fetch: app.fetch,
    hostname: config.HOST,
    port: config.PORT,
  });
  console.log(`Chisel listening on http://${config.HOST}:${config.PORT}`);
}
