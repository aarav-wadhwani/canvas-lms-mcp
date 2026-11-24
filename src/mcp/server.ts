/**
 * MCP Server setup and configuration
 * Registers all tools and prompts with the server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tools } from "./tools/index.ts";
import { prompts } from "./prompts/index.ts";
import type { AnyToolDefinition, ToolResponse } from "./types.ts";

// Read version from deno.json if available
let version = "1.0.0";
try {
  const denoJson = JSON.parse(await Deno.readTextFile("./deno.json"));
  version = denoJson.version || version;
} catch {
  // Use default version if deno.json not found
}

/**
 * Adapt our tool handler to the MCP SDK's expected signature
 * The SDK expects (args, extra) => response, but extra is optional
 */
function adaptToolHandler(handler: AnyToolDefinition["handler"]) {
  // deno-lint-ignore no-explicit-any
  return async (args: any, _extra: unknown): Promise<ToolResponse> => {
    return await handler(args);
  };
}

/**
 * Create and configure the MCP server with all tools and prompts
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "canvas-lms-mcp",
    version,
  });

  // Register all tools with annotations
  for (const tool of tools) {
    const adaptedHandler = adaptToolHandler(tool.handler);
    if (tool.annotations) {
      server.tool(
        tool.name,
        tool.description,
        tool.schema,
        tool.annotations,
        // deno-lint-ignore no-explicit-any
        adaptedHandler as any,
      );
    } else {
      server.tool(
        tool.name,
        tool.description,
        tool.schema,
        // deno-lint-ignore no-explicit-any
        adaptedHandler as any,
      );
    }
  }

  // Register all prompts
  for (const prompt of prompts) {
    // The SDK expects a Zod raw shape for prompt arguments, not an array of
    // {name, description, required}. Passing the array made prompts/list fail
    // with "field.isOptional is not a function". student_id is always made
    // optional (defaulting to "self") so students don't need to look up their ID.
    const argsShape: Record<string, z.ZodTypeAny> = {};
    for (const arg of prompt.arguments) {
      const base = z.string().describe(arg.description ?? arg.name);
      argsShape[arg.name] = arg.required && arg.name !== "student_id" ? base : base.optional();
    }
    // deno-lint-ignore no-explicit-any
    (server as any).prompt(
      prompt.name,
      prompt.description,
      argsShape,
      (args: Record<string, string | undefined>) =>
        prompt.handler({ ...args, student_id: args.student_id || "self" }),
    );
  }

  return server;
}

/**
 * Get server metadata
 */
export function getServerInfo() {
  return {
    name: "canvas-lms-mcp",
    version,
    tools: tools.map((t) => t.name),
    prompts: prompts.map((p) => p.name),
  };
}
