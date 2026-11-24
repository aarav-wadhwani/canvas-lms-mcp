# Cloudflare Workers deployment (private, single user)

Runs the same Canvas tools as a remote MCP server so Claude can use them from claude.ai and the
Claude mobile apps. Access is locked to one GitHub account.

## How it works

- `src/index.ts`: `OAuthProvider` from `@cloudflare/workers-oauth-provider`. `/mcp` requires an
  OAuth access token. Discovery, `/token` and `/register` are handled by the library.
- `src/auth.ts`: the sign-in flow.
  - Rejects redirect URIs outside `ALLOWED_REDIRECT_HOSTS` (plus loopback for desktop apps).
  - Shows a consent page naming the client and where tokens go.
  - Signs in with GitHub and only completes authorization for `ALLOWED_GITHUB_USER_ID` (numeric ID,
    which can't be reused). The GitHub token is discarded.
- `src/mcp.ts`: re-checks the user ID on every request, then serves the shared tools from `../src`
  over the MCP SDK's web-standard Streamable HTTP transport (stateless, JSON responses).
- `src/get-canvas-file.ts`: cloud replacement for `save_canvas_file`.
  - Returns the file to Claude directly, since a Worker has no disk.
  - Instructure's file storage currently refuses downloads from Cloudflare's network (406). In that
    case the tool returns a Canvas link the user can open instead.
- The Canvas token lives in an encrypted Worker secret. Downloads may only redirect through
  `DOWNLOAD_HOST_SUFFIXES`, and the token is only ever sent to the Canvas host.

Dependencies are pinned to exact versions and were installed with `--ignore-scripts`.

## Setup

```bash
cd cloudflare
npm ci --ignore-scripts
./node_modules/.bin/wrangler login --scopes account:read user:read workers:write workers_kv:write workers_scripts:write workers_tail:read
./node_modules/.bin/wrangler kv namespace create OAUTH_KV   # put the id in wrangler.jsonc
./node_modules/.bin/wrangler deploy                          # note the *.workers.dev URL
```

1. **Configure `wrangler.jsonc`:** set `MCP_SERVER_URL` (`https://<worker>.workers.dev/mcp`),
   `ALLOWED_GITHUB_USER_ID` (`gh api user -q .id`) and `CANVAS_BASE_URL`.
2. **Create a GitHub OAuth App** at <https://github.com/settings/applications/new>:
   - Homepage: `https://<worker>.workers.dev`
   - Authorization callback URL: `https://<worker>.workers.dev/callback`

   Put its Client ID in `GITHUB_CLIENT_ID`.
3. **Store the secrets** (each command prompts for the value; on macOS the Canvas token can be piped
   from the Keychain):

   ```bash
   ./node_modules/.bin/wrangler secret put GITHUB_CLIENT_SECRET
   security find-generic-password -a "$USER" -s canvas-mcp-token -w | ./node_modules/.bin/wrangler secret put CANVAS_API_TOKEN
   ./node_modules/.bin/wrangler deploy
   ```
4. **Connect:** in claude.ai go to Settings → Connectors → Add custom connector, and enter
   `https://<worker>.workers.dev/mcp`. Connectors added there also appear in the mobile apps.

**To revoke access:** revoke the Canvas token in Canvas, or delete the Worker (`wrangler delete`).

## Local testing

`test/` holds a local-only harness that calls the MCP handler directly with the allowed user's
identity, skipping OAuth, so the tools can be exercised under workerd. Never deploy it.

```bash
CANVAS_API_TOKEN="$(security find-generic-password -a "$USER" -s canvas-mcp-token -w)" \
  CLOUDFLARE_INCLUDE_PROCESS_ENV=true ./node_modules/.bin/wrangler dev -c test/wrangler.test.jsonc
```
