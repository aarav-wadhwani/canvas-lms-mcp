/**
 * Shared Zod schemas for MCP tool inputs
 */

import { z } from "zod";

/**
 * A Canvas object ID (course, assignment, ...).
 *
 * Accepts a number or a digit string. Large cross-shard IDs (above
 * Number.MAX_SAFE_INTEGER) are returned by this server as digit strings to
 * avoid rounding, so tools must accept them back as strings too.
 *
 * Output: safe integers become numbers (so equality checks against parsed
 * API data keep working); unsafe ones stay as their exact string, matching
 * how parseCanvasJson represents them. The output is typed as `number` for
 * compatibility with existing API helpers — at runtime it is only ever used
 * in URL paths and equality checks, where both forms behave correctly.
 */
export function canvasId() {
  return z
    .union([z.number().int(), z.string().regex(/^\d+$/, "Must be a numeric Canvas ID")])
    .transform((v): number => {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isSafeInteger(n)) return n;
      return (typeof v === "string" ? v : String(v)) as unknown as number;
    });
}
