/**
 * Tool: get_assignment_files
 * Files attached to or linked from an assignment's instructions (read-only)
 */

import { canvasId } from "../schemas.ts";
import { getAssignment } from "../../api/assignments.ts";
import { extractLinkedFileIds, getFile } from "../../api/files.ts";
import { formatBytes } from "../../utils/save.ts";
import { jsonResponse, type ToolDefinition } from "../types.ts";

export const schema = {
  course_id: canvasId().describe(
    "The internal Canvas Course ID. Use 'get_courses' to find this ID from a course name.",
  ),
  assignment_id: canvasId().describe(
    "The Canvas Assignment ID. Use 'list_assignments' or 'get_due_this_week' to find it.",
  ),
};

export const getAssignmentFilesTool: ToolDefinition<typeof schema> = {
  name: "get_assignment_files",
  description:
    "Find every Canvas file connected to one assignment: files attached to it AND files linked inside its instructions (handouts, templates, starter docs, PDFs of the prompt). Returns each file's file_id for use with 'save_canvas_file'. Works even when the course hides its Files tab.",
  schema,
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ course_id, assignment_id }) => {
    const assignment = await getAssignment(course_id, assignment_id);

    const found = new Map<number, string>(); // file_id -> source
    for (const att of assignment.attachments ?? []) found.set(att.id, "attachment");
    for (const id of extractLinkedFileIds(assignment.description)) {
      if (!found.has(id)) found.set(id, "linked in instructions");
    }

    const files = [];
    for (const [id, source] of found) {
      try {
        const f = await getFile(id, course_id);
        files.push({
          file_id: f.id,
          name: f.display_name,
          source,
          type: f["content-type"],
          size: formatBytes(f.size),
          accessible: !f.locked_for_user && !!f.url,
        });
      } catch (e) {
        files.push({
          file_id: id,
          name: null,
          source,
          accessible: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return jsonResponse({
      assignment: { id: assignment.id, name: assignment.name, html_url: assignment.html_url },
      count: files.length,
      files,
      note: files.length === 0
        ? "No Canvas files are attached to or linked from this assignment. External links (Google Docs, YouTube, etc.) are not Canvas files."
        : undefined,
    });
  },
};
