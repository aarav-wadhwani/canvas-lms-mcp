/**
 * Canvas Files API (read-only against Canvas)
 */

import { getClient } from "./client.ts";
import type { CanvasFile, CanvasFolder } from "../types/canvas.ts";

/** List all files in a course's Files area */
export function listCourseFiles(courseId: number, searchTerm?: string): Promise<CanvasFile[]> {
  return getClient().getAll<CanvasFile>(`/courses/${courseId}/files`, {
    search_term: searchTerm,
    sort: "name",
  });
}

/** List all folders in a course's Files area */
export function listCourseFolders(courseId: number): Promise<CanvasFolder[]> {
  return getClient().getAll<CanvasFolder>(`/courses/${courseId}/folders`);
}

/**
 * Get one file's metadata. Tries the course-scoped endpoint first (works
 * even when the Files tab is hidden from students), then the global one
 * (works for files linked from another course you can access).
 */
export async function getFile(fileId: number, courseId?: number): Promise<CanvasFile> {
  const client = getClient();
  if (courseId !== undefined) {
    try {
      return await client.get<CanvasFile>(`/courses/${courseId}/files/${fileId}`);
    } catch {
      // fall through to global lookup
    }
  }
  return client.get<CanvasFile>(`/files/${fileId}`);
}

/** Download a file's bytes (capped) */
export function downloadFile(
  file: CanvasFile,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  if (!file.url) {
    throw new Error(
      `"${file.display_name}" has no download URL (it may be locked: ${
        file.lock_explanation ?? "no reason given"
      })`,
    );
  }
  return getClient().download(file.url, maxBytes);
}

/**
 * Extract Canvas file IDs linked from HTML (e.g. assignment instructions).
 * Matches /files/123 and /courses/456/files/123 links on any host path.
 */
export function extractLinkedFileIds(html: string | null | undefined): number[] {
  if (!html) return [];
  const ids = new Set<number>();
  for (const m of html.matchAll(/\/files\/(\d+)/g)) {
    const n = Number(m[1]);
    if (Number.isSafeInteger(n)) ids.add(n);
  }
  return [...ids];
}
