/**
 * Canvas LMS MCP server on Cloudflare Workers.
 *
 *   /mcp                 MCP endpoint (Streamable HTTP), requires an OAuth access token (mcp.ts)
 *   /authorize,/callback Sign-in (auth.ts)
 *   /token,/register     OAuth endpoints implemented by the provider
 *   /.well-known/...     OAuth discovery metadata
 */

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { env as workerEnv } from "cloudflare:workers";
import { authHandler } from "./auth.ts";
import type { Env } from "./env.ts";
import { mcpHandler } from "./mcp.ts";

const mcpUrl = (workerEnv as unknown as Env).MCP_SERVER_URL;

export default new OAuthProvider<Env>({
  resourceMetadata: {
    resource: mcpUrl,
    authorization_servers: [new URL(mcpUrl).origin],
    resource_name: "Canvas LMS (read-only)",
  },
  apiRoute: "/mcp",
  apiHandler: mcpHandler,
  defaultHandler: authHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["canvas:read"],
  clientIdMetadataDocumentEnabled: true,
  accessTokenTTL: 3600,
});
