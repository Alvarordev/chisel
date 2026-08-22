import { Hono } from "hono";
import { auth } from "./index.ts";

function textBody(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)} | Chisel Planner</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #111318; color: #f5f7fa; }
      main { width: min(92vw, 440px); padding: 2rem; border: 1px solid #30343c; border-radius: 18px; background: #1b1e24; box-shadow: 0 24px 80px #0006; }
      h1 { margin-top: 0; font-size: 1.6rem; }
      p { color: #adb5c2; line-height: 1.5; }
      label { display: block; margin: 1rem 0 .4rem; color: #d7dce5; }
      input { box-sizing: border-box; width: 100%; padding: .75rem; border: 1px solid #4a515e; border-radius: 10px; background: #111318; color: inherit; }
      button { margin-top: 1.25rem; width: 100%; padding: .8rem; border: 0; border-radius: 10px; background: #e6b75a; color: #18130a; font-weight: 700; cursor: pointer; }
      .muted { font-size: .9rem; }
    </style>
  </head>
  <body><main>${body}</main></body>
</html>`;
}

function oauthQuery(request: Request): string {
  return new URL(request.url).searchParams.toString();
}

function authRequest(request: Request, path: string, body: Record<string, unknown>, accept: string): Request {
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.set("accept", accept);
  return new Request(new URL(path, request.url), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

export const authUiRoutes = new Hono();

authUiRoutes.get("/login", (c) => {
  const query = oauthQuery(c.req.raw);
  return c.html(page(
    "Sign in",
    `<h1>Sign in to Chisel</h1>
     <p>Authorize your planning data for the connected MCP client.</p>
     <form method="post" action="/login">
       <input type="hidden" name="oauth_query" value="${escapeHtml(query)}">
       <label for="email">Email</label>
       <input id="email" name="email" type="email" autocomplete="email" required>
       <label for="password">Password</label>
       <input id="password" name="password" type="password" autocomplete="current-password" required>
       <button type="submit">Continue</button>
     </form>
     <p class="muted">Account creation is closed. Ask the instance owner for access.</p>`,
  ));
});

authUiRoutes.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const request = authRequest(c.req.raw, "/api/auth/sign-in/email", {
    email: textBody(body.email),
    password: textBody(body.password),
    rememberMe: true,
    ...(textBody(body.oauth_query) ? { oauth_query: textBody(body.oauth_query) } : {}),
  }, "text/html");
  return auth.handler(request);
});

authUiRoutes.get("/consent", (c) => {
  const query = new URL(c.req.url).searchParams;
  const clientId = query.get("client_id") ?? "Unknown client";
  const scope = query.get("scope") ?? "mcp:tools";
  const signedQuery = oauthQuery(c.req.raw);
  return c.html(page(
    "Authorize client",
    `<h1>Authorize client</h1>
     <p><strong>${escapeHtml(clientId)}</strong> requests access to Chisel Planner.</p>
     <p>Requested scopes: <code>${escapeHtml(scope)}</code></p>
     <form method="post" action="/consent">
       <input type="hidden" name="oauth_query" value="${escapeHtml(signedQuery)}">
       <input type="hidden" name="accept" value="true">
       <button type="submit">Allow access</button>
     </form>
     <form method="post" action="/consent">
       <input type="hidden" name="oauth_query" value="${escapeHtml(signedQuery)}">
       <input type="hidden" name="accept" value="false">
       <button type="submit">Deny</button>
     </form>`,
  ));
});

authUiRoutes.post("/consent", async (c) => {
  const body = await c.req.parseBody();
  const request = authRequest(c.req.raw, "/api/auth/oauth2/consent", {
    accept: textBody(body.accept) === "true",
    ...(textBody(body.oauth_query) ? { oauth_query: textBody(body.oauth_query) } : {}),
  }, "application/json");
  const response = await auth.handler(request);
  if (!response.ok) return response;

  const payload = await response.json() as { redirect_uri?: string; url?: string };
  if (payload.redirect_uri) return c.redirect(payload.redirect_uri);
  if (payload.url) return c.redirect(payload.url);
  return c.json(payload);
});
