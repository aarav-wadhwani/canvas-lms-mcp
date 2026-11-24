/**
 * No-op stand-in for Deno's @std/dotenv, aliased in wrangler.jsonc.
 * The shared config module imports it, but on Workers configuration comes from
 * the Worker environment via setConfig(), so loadConfig() is never called.
 */
export function load(): Promise<Record<string, string>> {
  return Promise.resolve({});
}
