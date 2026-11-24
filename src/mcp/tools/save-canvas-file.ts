/**
 * Tool: save_canvas_file
 * Download a Canvas file and save it to the local download folder.
 *
 * Read-only toward Canvas (GET requests only). It does write to the local
 * disk, but only inside CANVAS_DOWNLOAD_DIR, and never overwrites a file.
 */

import { canvasId } from "../schemas.ts";
import { getCourse } from "../../api/courses.ts";
import { downloadFile, getFile } from "../../api/files.ts";
import { formatBytes, sanitizeName, saveUnique } from "../../utils/save.ts";
import { jsonResponse, type ToolDefinition } from "../types.ts";

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB

export const schema = {
  file_id: canvasId().describe(
    "The Canvas file ID, from 'list_course_files' or 'get_assignment_files'.",
  ),
  course_id: canvasId().optional().describe(
    "The course the file belongs to. Recommended: used to sort the file into a per-course folder and to access files when the Files tab is hidden.",
  ),
};

export const saveCanvasFileTool: ToolDefinition<typeof schema> = {
  name: "save_canvas_file",
  description:
    "Download a file from Canvas and save it on the user's computer, in a per-course subfolder of their Canvas downloads folder. Returns the absolute local path. Existing files are never overwritten (a numbered copy is created instead). Max 100 MB. After saving, read the file from the returned path if you need its contents (e.g. to read a PDF handout or assignment prompt).",
  schema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
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
        `"${file.display_name}" is ${formatBytes(file.size)}, over the 100 MB limit`,
      );
    }

    let subfolder = "Other";
    if (course_id !== undefined) {
      try {
        const course = await getCourse(course_id);
        subfolder = sanitizeName(course.course_code || course.name, `course-${course_id}`);
      } catch {
        subfolder = `course-${course_id}`;
      }
    }

    const { bytes, contentType } = await downloadFile(file, MAX_BYTES);
    const name = sanitizeName(file.display_name || file.filename, `canvas-file-${file.id}`);
    const path = await saveUnique(subfolder, name, bytes);

    return jsonResponse({
      saved: true,
      path,
      name: file.display_name,
      size: formatBytes(bytes.length),
      type: contentType?.split(";")[0] ?? file["content-type"],
    });
  },
};
