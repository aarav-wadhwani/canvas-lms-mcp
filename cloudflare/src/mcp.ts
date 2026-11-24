/**
 * MCP endpoint handler (runs only after OAuthProvider has validated the token).
 * Reuses the shared tools from ../../src unchanged, except that the local
 * save_canvas_file tool is swapped for get_canvas_file.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer } from "../../src/mcp/server.ts";
import { tools } from "../../src/mcp/tools/index.ts";
import { initClient } from "../../src/api/client.ts";
import { setConfig } from "../../src/utils/config.ts";
import { type AuthProps, csv, type Env } from "./env.ts";
import { getCanvasFileTool } from "./get-canvas-file.ts";

const cloudTools = [
  ...tools.filter((t) => t.name !== "save_canvas_file"),
  getCanvasFileTool,
];

export const mcpHandler: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    // Defense in depth: tokens are only ever issued to the allowed GitHub user,
    // but re-check the identity carried by the token on every request.
    const props = (ctx as ExecutionContext & { props?: AuthProps }).props;
    if (
      !props || String(props.githubId) !== env.ALLOWED_GITHUB_USER_ID.trim()
    ) {
      return new Response("Forbidden", { status: 403 });
    }

    // Configure the shared Canvas client from Worker env/secrets
    setConfig({
      apiToken: env.CANVAS_API_TOKEN,
      baseUrl: env.CANVAS_BASE_URL,
      studentId: "self",
    });
    initClient({
      apiToken: env.CANVAS_API_TOKEN,
      baseUrl: env.CANVAS_BASE_URL,
      downloadHostSuffixes: csv(env.DOWNLOAD_HOST_SUFFIXES),
    });

    // Stateless: a fresh server + transport per request, JSON responses
    const server = createServer(cloudTools);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      // Release per-request resources once the response is produced
      transport.close().catch(() => {});
    }
  },
};
