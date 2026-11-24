/**
 * Minimal HTML-to-text conversion for Canvas rich content (assignment
 * descriptions, etc.). Keeps structure (paragraphs, list items, line breaks)
 * and link targets so the instructions stay readable, without pulling in a
 * full HTML parser dependency.
 */

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";

  let text = html
    // Drop script/style blocks entirely
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    // Links: "text (url)" so targets are not lost
    .replace(
      /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_m, href: string, inner: string) => {
        const raw = inner.replace(/<[^>]+>/g, "");
        const label = raw.trim();
        // Keep whitespace that sat just inside the tag, so surrounding words don't fuse
        const lead = /^\s/.test(raw) ? " " : "";
        const trail = /\s$/.test(raw) ? " " : "";
        return lead + (label && label !== href ? `${label} (${href})` : href) + trail;
      },
    )
    // Block-level structure
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|li|tr|table|ul|ol|blockquote)>/gi, "\n")
    .replace(/<(p|div|h[1-6]|tr|table|ul|ol|blockquote)[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    // Remove any remaining tags
    .replace(/<[^>]+>/g, "");

  // Decode common entities and numeric references
  text = text
    .replace(/&[a-z#0-9]+;/gi, (e) => {
      if (ENTITIES[e]) return ENTITIES[e];
      const num = e.match(/^&#(x?)([0-9a-f]+);$/i);
      if (num) {
        const code = parseInt(num[2], num[1] ? 16 : 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : e;
      }
      return e;
    });

  // Normalize whitespace
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
