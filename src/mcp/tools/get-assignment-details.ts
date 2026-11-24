/**
 * Tool: get_assignment_details
 * Full instructions and requirements for a single assignment (read-only)
 */

import { z } from "zod";
import { canvasId } from "../schemas.ts";
import { getAssignment } from "../../api/assignments.ts";
import { htmlToText } from "../../utils/html.ts";
import { jsonResponse, type ToolDefinition } from "../types.ts";

export const schema = {
  course_id: canvasId().describe(
    "The internal Canvas Course ID. Use 'get_courses' to find this ID from a course name.",
  ),
  assignment_id: canvasId().describe(
    "The Canvas Assignment ID. Use 'list_assignments', 'get_due_this_week', or 'get_upcoming_assignments' to find it.",
  ),
  include_rubric: z.boolean().optional().default(true).describe(
    "Include the grading rubric criteria (default: true)",
  ),
};

export const getAssignmentDetailsTool: ToolDefinition<typeof schema> = {
  name: "get_assignment_details",
  description:
    "Get the FULL instructions/prompt for one assignment: the teacher's description (converted to plain text), due/unlock/lock dates, points, submission types, allowed file extensions, attempts allowed, lock status, attached files, the grading rubric, and your current submission status. Use this when the user asks what an assignment requires, wants help starting or planning it, or asks 'what do I need to do for X'. Other tools only list assignments; this one reads the actual instructions.",
  schema,
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ course_id, assignment_id, include_rubric }) => {
    const a = await getAssignment(course_id, assignment_id, ["submission"]);

    return jsonResponse({
      id: a.id,
      name: a.name,
      course_id: a.course_id,
      html_url: a.html_url,
      instructions: htmlToText(a.description) || null,
      due_at: a.due_at,
      unlock_at: a.unlock_at,
      lock_at: a.lock_at,
      points_possible: a.points_possible,
      grading_type: a.grading_type,
      submission_types: a.submission_types,
      allowed_extensions: a.allowed_extensions,
      allowed_attempts: a.allowed_attempts === -1 ? "unlimited" : a.allowed_attempts,
      locked_for_user: a.locked_for_user,
      lock_explanation: a.lock_explanation,
      external_tool_url: a.external_tool_tag_attributes?.url,
      attachments: a.attachments?.map((f) => ({
        name: f.display_name,
        content_type: f.content_type,
        size: f.size,
        url: f.url,
      })),
      rubric: include_rubric && a.rubric
        ? {
          title: a.rubric_settings?.title,
          points_possible: a.rubric_settings?.points_possible,
          used_for_grading: a.use_rubric_for_grading,
          criteria: a.rubric.map((c) => ({
            description: c.description,
            details: c.long_description || undefined,
            points: c.points,
            ratings: c.ratings.map((r) => ({
              description: r.description,
              details: r.long_description || undefined,
              points: r.points,
            })),
          })),
        }
        : include_rubric
        ? null
        : undefined,
      your_submission: a.submission
        ? {
          status: a.submission.workflow_state,
          submitted_at: a.submission.submitted_at,
          grade: a.submission.grade,
          score: a.submission.score,
          late: a.submission.late,
          missing: a.submission.missing,
          excused: a.submission.excused,
        }
        : null,
    });
  },
};
