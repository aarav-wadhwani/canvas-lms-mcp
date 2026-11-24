import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  /** KV namespace the OAuth provider stores clients, grants and tokens in */
  OAUTH_KV: KVNamespace;
  /** Injected by OAuthProvider at runtime */
  OAUTH_PROVIDER: OAuthHelpers;

  // Plain vars (wrangler.jsonc)
  CANVAS_BASE_URL: string;
  /** Public URL of the /mcp endpoint, e.g. https://canvas-mcp.<sub>.workers.dev/mcp */
  MCP_SERVER_URL: string;
  /** Numeric GitHub user ID allowed to sign in (IDs can't be reused, unlike logins) */
  ALLOWED_GITHUB_USER_ID: string;
  /** Comma-separated hostnames OAuth redirects may go to, e.g. "claude.ai,claude.com" */
  ALLOWED_REDIRECT_HOSTS: string;
  /** Comma-separated domains file downloads may redirect through */
  DOWNLOAD_HOST_SUFFIXES: string;
  GITHUB_CLIENT_ID: string;

  // Secrets (wrangler secret put)
  CANVAS_API_TOKEN: string;
  GITHUB_CLIENT_SECRET: string;
}

/** What completeAuthorization() stores and the MCP handler receives as ctx.props */
export interface AuthProps {
  githubId: number;
  githubLogin: string;
}

export function csv(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
