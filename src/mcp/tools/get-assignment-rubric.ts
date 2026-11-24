/**
 * Tool: get_assignment_rubric
 * Rubric criteria for an assignment, plus how you were scored on each
 * criterion once it has been graded (read-only)
 */

import { z } from "zod";
import { canvasId } from "../schemas.ts";
import { getAssignment } from "../../api/assignments.ts";
import { getSubmission } from "../../api/submissions.ts";
import { getConfig } from "../../utils/config.ts";
import { errorResponse, jsonResponse, type ToolDefinition } from "../types.ts";

export const schema = {
  course_id: canvasId().describe(
    "The internal Canvas Course ID. Use 'get_courses' to find this ID from a course name.",
  ),
  assignment_id: canvasId().describe(
    "The Canvas Assignment ID. Use 'list_assignments' or 'get_upcoming_assignments' to find it.",
  ),
  student_id: z.string().optional().describe(
    "Student ID for observer/parent accounts. Omit to use your own account.",
  ),
};

export const getAssignmentRubricTool: ToolDefinition<typeof schema> = {
  name: "get_assignment_rubric",
  description:
    "Get the grading rubric for one assignment: every criterion with its rating levels and point values. If the assignment has been graded with the rubric, also returns the score, selected rating, and instructor comment for EACH criterion. Use this to check work against the rubric before submitting, or to understand where points were lost after grading.",
  schema,
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ course_id, assignment_id, student_id }) => {
    const assignment = await getAssignment(course_id, assignment_id);

    if (!assignment.rubric || assignment.rubric.length === 0) {
      return errorResponse(
        `Assignment "${assignment.name}" does not have a rubric attached. Use get_assignment_details to read its instructions instead.`,
      );
    }

    // Rubric assessment is optional: it only exists once graded, and some
    // instructors hide it. Never fail the whole tool because of it.
    let assessment:
      | Record<
        string,
        { points?: number | null; rating_id?: string | null; comments?: string | null }
      >
      | undefined;
    let submissionScore: number | null = null;
    try {
      const userId = student_id || getConfig().studentId || "self";
      const submission = await getSubmission(course_id, assignment_id, userId, [
        "rubric_assessment",
      ]);
      assessment = submission.rubric_assessment;
      submissionScore = submission.score;
    } catch {
      assessment = undefined;
    }

    const criteria = assignment.rubric.map((c) => {
      const scored = assessment?.[c.id];
      const selected = scored?.rating_id
        ? c.ratings.find((r) => r.id === scored.rating_id)
        : undefined;
      return {
        description: c.description,
        details: c.long_description || undefined,
        points_possible: c.points,
        ratings: c.ratings.map((r) => ({
          description: r.description,
          details: r.long_description || undefined,
          points: r.points,
        })),
        your_score: scored
          ? {
            points: scored.points ?? null,
            rating: selected?.description ?? null,
            comments: scored.comments || null,
          }
          : undefined,
      };
    });

    return jsonResponse({
      assignment: {
        id: assignment.id,
        name: assignment.name,
        html_url: assignment.html_url,
        points_possible: assignment.points_possible,
      },
      rubric_title: assignment.rubric_settings?.title,
      rubric_points_possible: assignment.rubric_settings?.points_possible,
      used_for_grading: assignment.use_rubric_for_grading,
      graded_with_rubric: !!assessment && Object.keys(assessment).length > 0,
      total_score: submissionScore,
      criteria,
    });
  },
};
