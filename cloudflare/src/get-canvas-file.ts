/**
 * Tool: get_canvas_file (cloud replacement for save_canvas_file)
 *
 * A Worker has no local disk, so instead of saving, the file is returned to
 * Claude directly: PDFs as an embedded resource, images as image content,
 * text-like files as text. Read-only toward Canvas.
 */

import { canvasId } from "../../src/mcp/schemas.ts";
import { downloadFile, getFile } from "../../src/api/files.ts";
import { formatBytes } from "../../src/utils/save.ts";
import { getConfig } from "../../src/utils/config.ts";
import type { ToolContentItem, ToolDefinition } from "../../src/mcp/types.ts";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB: keeps tool results a manageable size

const TEXT_TYPES = /^(text\/|application\/(json|xml|csv|javascript|x-python|x-sh|sql))/;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export const schema = {
  file_id: canvasId().describe(
    "The Canvas file ID, from 'list_course_files' or 'get_assignment_files'.",
  ),
  course_id: canvasId().optional().describe(
    "The course the file belongs to. Recommended: lets hidden-Files-tab courses work.",
  ),
};

export const getCanvasFileTool: ToolDefinition<typeof schema> = {
  name: "get_canvas_file",
  description:
    "Download a file from Canvas and return its contents so you can read it (if Canvas's file storage refuses the cloud download, returns a link the user can open instead): PDFs are attached as a document, images as an image, and text/code/CSV files as text. Max 5 MB. Word/PowerPoint files are returned as attachments that may not be readable; ask the user to export them to PDF if so. Use 'list_course_files' or 'get_assignment_files' to find file IDs.",
  schema,
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ file_id, course_id }) => {
    const file = await getFile(file_id, course_id);
    if (file.locked_for_user) {
      throw new Error(
        `"${file.display_name}" is locked${
          file.lock_explanation ? `: ${file.lock_explanation}` : ""
        }`,
      );
    }
    if (file.size > MAX_BYTES) {
      throw new Error(
        `"${file.display_name}" is ${
          formatBytes(file.size)
        }; the cloud server returns files up to 5 MB.`,
      );
    }

    const courseForLink = course_id ?? undefined;
    const canvasLink = courseForLink !== undefined
      ? `${getConfig().baseUrl}/courses/${courseForLink}/files/${file.id}`
      : `${getConfig().baseUrl}/files/${file.id}`;

    let downloaded: { bytes: Uint8Array; contentType: string | null };
    try {
      downloaded = await downloadFile(file, MAX_BYTES);
    } catch (e) {
      // Instructure's file storage refuses some requests from cloud networks.
      // Don't fail the whole tool: give the user a link they can open instead.
      return {
        content: [{
          type: "text",
          text: JSON.stringify(
            {
              downloaded: false,
              name: file.display_name,
              type: file["content-type"],
              size: formatBytes(file.size),
              open_in_canvas: canvasLink,
              reason: e instanceof Error ? e.message : String(e),
              note:
                "Canvas's file storage refused the download from the cloud server. Give the user the open_in_canvas link so they can open the file themselves; they can attach it to the chat if they want you to read it. The local (Mac) version of this server can download files directly.",
            },
            null,
            2,
          ),
        }],
      };
    }
    const { bytes, contentType } = downloaded;
    const mime = (contentType?.split(";")[0] || file["content-type"] ||
      "application/octet-stream")
      .trim();
    const summary = `${file.display_name} (${mime}, ${formatBytes(bytes.length)})`;

    const content: ToolContentItem[] = [{ type: "text", text: summary }];
    if (TEXT_TYPES.test(mime)) {
      content.push({ type: "text", text: new TextDecoder().decode(bytes) });
    } else if (mime.startsWith("image/")) {
      content.push({ type: "image", data: toBase64(bytes), mimeType: mime });
    } else {
      content.push({
        type: "resource",
        resource: {
          uri: `canvas://files/${file.id}/${encodeURIComponent(file.display_name)}`,
          mimeType: mime,
          blob: toBase64(bytes),
        },
      });
    }
    return { content };
  },
};
