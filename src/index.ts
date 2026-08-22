import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config } from "./config.ts";
import { apiRoutes } from "./api/routes.ts";
import { mcpHandler } from "./mcp/server.ts";

export function createApp() {
  const app = createMcpHonoApp({
    host: config.HOST,
    allowedHosts: config.ALLOWED_HOSTS.split(",").map((host) => host.trim()).filter(Boolean),
    allowedOrigins: config.ALLOWED_ORIGIN_HOSTS.split(",").map((host) => host.trim()).filter(Boolean),
  });

  app.use("/api/*", logger());
  app.use("/api/*", cors());

  app.get("/health", (c) =>
    c.json({ ok: true, service: "chisel-planner", protocol: config.MCP_PROTOCOL_VERSION }),
  );
  app.route("/api", apiRoutes);
  app.all("/mcp", async (c) => mcpHandler.fetch(c.req.raw));

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
