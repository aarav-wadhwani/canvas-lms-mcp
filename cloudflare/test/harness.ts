/**
 * LOCAL TEST ONLY (never deployed): calls the MCP handler directly with the
 * allowed user's props, skipping OAuth, so tools can be exercised under workerd.
 * Run with: wrangler dev -c test/wrangler.test.jsonc
 */
import { mcpHandler } from "../src/mcp.ts";
import type { Env } from "../src/env.ts";

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (!["127.0.0.1", "localhost"].includes(new URL(request.url).hostname)) {
      return new Response("local only", { status: 403 });
    }
    const c = Object.assign(Object.create(ctx), {
      props: {
        githubId: Number(env.ALLOWED_GITHUB_USER_ID),
        githubLogin: "test",
      },
    });
    return mcpHandler.fetch!(request as never, env, c);
  },
};
