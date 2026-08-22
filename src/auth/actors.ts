import type { AuthInfo } from "@modelcontextprotocol/server";
import type { JWTPayload } from "jose";
import { config } from "../config.ts";
import type { ActorContext, AgentClient } from "../core/context.ts";
import { ensureUser } from "../db/system.ts";
import { auth, ensureAuthSchema } from "./index.ts";

export function agentClientFromRequest(request: Request): AgentClient {
  const userAgent = request.headers.get("user-agent")?.toLowerCase() ?? "";
  if (userAgent.includes("claude")) return "claude";
  if (userAgent.includes("chatgpt")) return "chatgpt";
  if (userAgent.includes("gemini")) return "gemini";
  return null;
}

export async function actorFromSession(
  request: Request,
  source: ActorContext["source"],
): Promise<ActorContext | null> {
  await ensureAuthSchema();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;

  await ensureUser({ id: session.user.id, email: session.user.email });
  return {
    userId: session.user.id,
    source,
    agentClient: agentClientFromRequest(request),
  };
}

export function authInfoFromClaims(request: Request, claims: JWTPayload): AuthInfo {
  const scope = typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [];
  const clientId = typeof claims.client_id === "string"
    ? claims.client_id
    : typeof claims.azp === "string"
      ? claims.azp
      : typeof claims.sub === "string"
        ? claims.sub
        : "unknown-client";
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";

  return {
    token: bearer,
    clientId,
    scopes: scope,
    expiresAt: claims.exp,
    resource: new URL(config.MCP_RESOURCE),
    extra: { ...claims },
  };
}

export async function actorFromMcpAuth(
  authInfo: AuthInfo,
  request: Request,
): Promise<ActorContext> {
  const subject = authInfo.extra?.sub;
  if (typeof subject !== "string" || subject.length === 0) {
    throw new Error("Authenticated token has no user subject");
  }

  await ensureUser({ id: subject });
  return {
    userId: subject,
    source: "agent",
    agentClient: agentClientFromRequest(request),
  };
}
