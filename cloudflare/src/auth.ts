/**
 * Sign-in for the single allowed user.
 *
 * Flow (all state handling — CSRF, browser binding, one-time use — is done by
 * @cloudflare/workers-oauth-provider's consent and upstream helpers):
 *
 *   GET  /authorize  MCP client sends the user here. We reject redirect URIs
 *                    outside ALLOWED_REDIRECT_HOSTS, then show a consent page
 *                    naming the client and where tokens will go.
 *   POST /authorize  User approves (or denies). On approve we hand off to
 *                    GitHub sign-in.
 *   GET  /callback   GitHub returns. We look up the GitHub user and only
 *                    complete authorization if their numeric ID matches
 *                    ALLOWED_GITHUB_USER_ID. The GitHub token is discarded.
 */

import { AuthorizationError } from "@cloudflare/workers-oauth-provider";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { type AuthProps, csv, type Env } from "./env.ts";

const SCOPE = "canvas:read";

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

function page(
  title: string,
  body: string,
  status = 200,
  headers?: Headers,
): Response {
  const h = new Headers(headers);
  h.set("Content-Type", "text/html; charset=utf-8");
  h.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  );
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Cache-Control", "no-store");
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#1a1a1a;background:#fafafa}
  .card{background:#fff;border:1px solid #ddd;border-radius:12px;padding:1.5rem}
  h1{font-size:1.25rem;margin:0 0 1rem}
  .warn{background:#fff4e5;border:1px solid #f0c27b;border-radius:8px;padding:.75rem;margin:1rem 0}
  dl{margin:1rem 0} dt{font-weight:600;margin-top:.5rem} dd{margin:0;word-break:break-all}
  .row{display:flex;gap:.75rem;margin-top:1.5rem}
  button{font:inherit;padding:.6rem 1.2rem;border-radius:8px;border:1px solid #888;background:#fff;cursor:pointer}
  button.primary{background:#1a1a1a;color:#fff;border-color:#1a1a1a}
  @media (prefers-color-scheme:dark){body{background:#111;color:#eee}.card{background:#1c1c1c;border-color:#333}.warn{background:#3a2a10;border-color:#7a5a20}button{background:#222;color:#eee}button.primary{background:#eee;color:#111}}
</style></head><body><div class="card">${body}</div></body></html>`,
    { status, headers: h },
  );
}

function errorPage(message: string, status = 400): Response {
  return page(
    "Canvas MCP: error",
    `<h1>Can't continue</h1><p>${escapeHtml(message)}</p>`,
    status,
  );
}

function redirectAllowed(authRequest: AuthRequest, env: Env): boolean {
  let url: URL;
  try {
    url = new URL(authRequest.redirectUri);
  } catch {
    return false;
  }
  const host = url.hostname;
  const isLoopback = host === "localhost" || host === "127.0.0.1" ||
    host === "[::1]";
  if (isLoopback) return url.protocol === "http:" || url.protocol === "https:";
  return url.protocol === "https:" &&
    csv(env.ALLOWED_REDIRECT_HOSTS).includes(host);
}

/** GET /authorize: validate and show consent */
async function showConsent(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const authRequest = await oauth.parseAuthRequest(request);

  if (!redirectAllowed(authRequest, env)) {
    return errorPage(
      `This server only signs in Claude apps. Redirect to "${authRequest.redirectUri}" is not allowed.`,
      403,
    );
  }

  const d = await oauth.describeConsent(authRequest);
  const tx = await oauth.beginConsent(authRequest);

  const body = `
    <h1>Allow access to your Canvas?</h1>
    <p><strong>${escapeHtml(d.clientName)}</strong> wants read-only access to your Canvas account
    (courses, assignments, grades, announcements, inbox, files).</p>
    <dl>
      ${d.clientDomain ? `<dt>Verified app domain</dt><dd>${escapeHtml(d.clientDomain)}</dd>` : ""}
      <dt>Access will be sent to</dt><dd>${escapeHtml(d.redirectHost)}</dd>
    </dl>
    ${
    d.redirectIsLoopback
      ? `<div class="warn">This sends access to an app on your own computer (${
        escapeHtml(d.redirectHost)
      }). Only continue if you just started connecting from Claude Code or Claude Desktop.</div>`
      : ""
  }
    <p>Next you'll sign in with GitHub. Only the owner's GitHub account is accepted.</p>
    <form method="post" action="/authorize">
      <input type="hidden" name="handle" value="${escapeHtml(tx.handle)}">
      <div class="row">
        <button class="primary" type="submit" name="decision" value="approve">Continue with GitHub</button>
        <button type="submit" name="decision" value="deny">Deny</button>
      </div>
    </form>`;
  return page("Canvas MCP: allow access?", body, 200, tx.headers);
}

/** POST /authorize: user decided */
async function handleConsent(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const form = await request.formData();
  const handle = String(form.get("handle") ?? "");

  if (form.get("decision") !== "approve") {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }

  const approved = await oauth.approveConsent(request, handle, {
    scope: [SCOPE],
  });
  const upstream = await oauth.beginUpstream(approved.request, {
    headers: approved.headers,
  });

  const gh = new URL("https://github.com/login/oauth/authorize");
  gh.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  gh.searchParams.set(
    "redirect_uri",
    new URL("/callback", request.url).toString(),
  );
  gh.searchParams.set("state", upstream.state);
  gh.searchParams.set("allow_signup", "false");
  // No scopes: we only need the public identity of the signed-in user.

  const headers = new Headers(upstream.headers);
  headers.set("Location", gh.toString());
  return new Response(null, { status: 302, headers });
}

/** GET /callback: GitHub returned */
async function handleCallback(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const { request: authRequest, headers } = await oauth.finishUpstream(request);

  const code = new URL(request.url).searchParams.get("code");
  if (!code) return errorPage("GitHub sign-in was cancelled.");

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: new URL("/callback", request.url).toString(),
    }),
  });
  const tokenJson = await tokenRes.json() as {
    access_token?: string;
    error?: string;
  };
  if (!tokenJson.access_token) {
    return errorPage(
      `GitHub sign-in failed (${tokenJson.error ?? tokenRes.status}).`,
      502,
    );
  }

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "canvas-lms-mcp-worker",
    },
  });
  if (!userRes.ok) return errorPage("Could not read your GitHub profile.", 502);
  const user = await userRes.json() as { id: number; login: string };

  if (String(user.id) !== env.ALLOWED_GITHUB_USER_ID.trim()) {
    return errorPage(
      `GitHub account "${user.login}" is not allowed to use this server.`,
      403,
    );
  }

  const props: AuthProps = { githubId: user.id, githubLogin: user.login };
  const { redirectTo } = await oauth.completeAuthorization({
    request: authRequest,
    userId: String(user.id),
    metadata: { label: user.login },
    scope: authRequest.scope.length ? authRequest.scope : [SCOPE],
    props,
  });

  const out = new Headers(headers);
  out.set("Location", redirectTo);
  return new Response(null, { status: 302, headers: out });
}

/** Default handler: everything that isn't the protected /mcp API */
export const authHandler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/authorize") {
        if (request.method === "GET") return await showConsent(request, env);
        if (request.method === "POST") return await handleConsent(request, env);
        return new Response("Method not allowed", { status: 405 });
      }
      if (url.pathname === "/callback" && request.method === "GET") {
        return await handleCallback(request, env);
      }
      if (url.pathname === "/") {
        return page(
          "Canvas MCP",
          "<h1>Canvas MCP server</h1><p>Private server. Connect from Claude using this site's /mcp URL.</p>",
        );
      }
      return new Response("Not found", { status: 404 });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        const e = error as AuthorizationError & {
          redirectTo?: string;
          description?: string;
        };
        if (e.redirectTo) return Response.redirect(e.redirectTo, 302);
        return errorPage(e.description ?? e.message);
      }
      console.error(
        "auth error",
        error instanceof Error ? error.message : String(error),
      );
      return errorPage("Something went wrong during sign-in.", 500);
    }
  },
};
