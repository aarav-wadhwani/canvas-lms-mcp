/**
 * Tool: list_course_files
 * List files in a course's Files tab (read-only)
 */

import { z } from "zod";
import { canvasId } from "../schemas.ts";
import { listCourseFiles, listCourseFolders } from "../../api/files.ts";
import { formatBytes } from "../../utils/save.ts";
import { errorResponse, jsonResponse, type ToolDefinition } from "../types.ts";

export const schema = {
  course_id: canvasId().describe(
    "The internal Canvas Course ID. Use 'get_courses' to find this ID from a course name.",
  ),
  search_term: z.string().min(2).optional().describe(
    "Filter by file name (at least 2 characters), e.g. 'lecture 5' or 'syllabus'",
  ),
};

export const listCourseFilesTool: ToolDefinition<typeof schema> = {
  name: "list_course_files",
  description:
    "List the files in a course's Files tab (lecture slides, notes, handouts, PDFs) with folder, type, size and last-modified date. Returns each file's file_id for use with 'save_canvas_file'. Use 'search_term' to find a specific file. If the course hides its Files tab, use 'get_assignment_files' for files attached to assignments instead.",
  schema,
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ course_id, search_term }) => {
    let files;
    try {
      files = await listCourseFiles(course_id, search_term);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResponse(
        `Could not list files for this course (${msg}). The instructor may have hidden the Files tab; try 'get_assignment_files' to find files attached to specific assignments.`,
      );
    }

    // Folder names are nice-to-have; don't fail the tool without them
    const folderNames = new Map<number, string>();
    try {
      for (const f of await listCourseFolders(course_id)) {
        folderNames.set(f.id, f.full_name.replace(/^course files\/?/, "") || "/");
      }
    } catch {
      // ignore
    }

    return jsonResponse({
      course_id,
      count: files.length,
      files: files.map((f) => ({
        file_id: f.id,
        name: f.display_name,
        folder: folderNames.get(f.folder_id) ?? null,
        type: f["content-type"],
        size: formatBytes(f.size),
        modified: f.modified_at ?? f.updated_at,
        locked: f.locked_for_user || undefined,
      })),
    });
  },
};
