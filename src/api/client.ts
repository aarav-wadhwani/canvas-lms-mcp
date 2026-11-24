/**
 * Canvas API Client
 * Handles authentication, pagination, and HTTP requests
 */

import type { ApiError, PaginationLinks } from "../types/canvas.ts";

/** Canvas rejects requests without a User-Agent (403), and Workers fetch sends none */
const USER_AGENT = "canvas-lms-mcp";

/**
 * Parse a Canvas JSON response without losing precision on large IDs.
 *
 * Canvas cross-shard IDs (e.g. 28348000000000123) exceed
 * Number.MAX_SAFE_INTEGER, so plain JSON.parse silently rounds them and any
 * follow-up request using that ID hits the wrong resource. Integers that
 * cannot be represented exactly are kept as their original digit string;
 * every other number is untouched. Canvas accepts either form in URLs.
 */
export function parseCanvasJson<T>(text: string): T {
  return JSON.parse(
    text,
    // deno-lint-ignore no-explicit-any
    (_key: string, value: unknown, context?: { source?: string }): any => {
      if (
        typeof value === "number" && !Number.isSafeInteger(value) &&
        context?.source && /^-?\d+$/.test(context.source)
      ) {
        return context.source;
      }
      return value;
    },
  ) as T;
}

export interface ClientOptions {
  baseUrl: string;
  apiToken: string;
  /** Items per page for paginated requests (default: 100) */
  perPage?: number;
  /**
   * If set, file downloads may only follow redirects to the Canvas host or to
   * hosts ending in one of these domains (e.g. "inscloudgate.net"). Used where
   * there is no runtime sandbox (Cloudflare Workers); under Deno the
   * --allow-net flag enforces this instead.
   */
  downloadHostSuffixes?: string[];
}

export class CanvasClient {
  private baseUrl: string;
  private apiToken: string;
  private perPage: number;
  private downloadHostSuffixes?: string[];

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiToken = options.apiToken;
    this.perPage = options.perPage || 100;
    this.downloadHostSuffixes = options.downloadHostSuffixes;
  }

  /**
   * Build the full URL for an API endpoint
   */
  private buildUrl(
    path: string,
    params?: Record<string, string | string[] | number | boolean | undefined>,
  ): string {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);

    // Add per_page by default for list endpoints
    url.searchParams.set("per_page", String(this.perPage));

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue;

        if (Array.isArray(value)) {
          // Handle array params like include[]=foo&include[]=bar
          for (const v of value) {
            url.searchParams.append(`${key}[]`, v);
          }
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  /**
   * Parse Link header for pagination
   */
  private parseLinkHeader(linkHeader: string | null): PaginationLinks {
    if (!linkHeader) return {};

    const links: PaginationLinks = {};
    const parts = linkHeader.split(",");

    for (const part of parts) {
      const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
      if (match) {
        const [, url, rel] = match;
        links[rel as keyof PaginationLinks] = url;
      }
    }

    return links;
  }

  /**
   * Make an authenticated request to the Canvas API
   */
  async fetch<T>(
    path: string,
    options?: {
      method?: string;
      params?: Record<string, string | string[] | number | boolean | undefined>;
      body?: unknown;
    },
  ): Promise<{ data: T; links: PaginationLinks }> {
    const { method = "GET", params, body } = options || {};
    const url = this.buildUrl(path, params);

    const headers: HeadersInit = {
      Authorization: `Bearer ${this.apiToken}`,
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (body) {
      headers["Content-Type"] = "application/json";
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      let errorMessage = `Canvas API error: ${response.status} ${response.statusText}`;

      try {
        const errorData: ApiError = await response.json();
        if (errorData.message) {
          errorMessage = errorData.message;
        } else if (errorData.errors?.length) {
          errorMessage = errorData.errors.map((e) => e.message).join(", ");
        }
      } catch {
        // Couldn't parse error body, use default message
      }

      throw new Error(errorMessage);
    }

    const data = parseCanvasJson<T>(await response.text());
    const links = this.parseLinkHeader(response.headers.get("Link"));

    return { data, links };
  }

  /**
   * Fetch all pages of a paginated endpoint
   */
  async fetchAll<T>(
    path: string,
    options?: {
      params?: Record<string, string | string[] | number | boolean | undefined>;
      /** Maximum number of items to fetch (default: unlimited) */
      limit?: number;
    },
  ): Promise<T[]> {
    const { params, limit } = options || {};
    const results: T[] = [];

    let url: string | undefined = this.buildUrl(path, params);

    while (url) {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        let errorMessage = `Canvas API error: ${response.status} ${response.statusText}`;

        try {
          const errorData: ApiError = await response.json();
          if (errorData.message) {
            errorMessage = errorData.message;
          }
        } catch {
          // Couldn't parse error body
        }

        throw new Error(errorMessage);
      }

      const data = parseCanvasJson<T[]>(await response.text());
      results.push(...data);

      // Check if we've hit the limit
      if (limit && results.length >= limit) {
        return results.slice(0, limit);
      }

      // Get next page URL from Link header
      const links = this.parseLinkHeader(response.headers.get("Link"));
      url = links.next;
    }

    return results;
  }

  /**
   * Download raw file bytes from a Canvas file URL.
   *
   * Canvas file URLs redirect through several storage hosts
   * (canvas-user-content.com, inscloudgate.net). Redirects are followed
   * manually so the API token is sent ONLY to the Canvas host itself and is
   * never forwarded to third-party storage. The body is streamed with a hard
   * byte cap so an oversized file cannot exhaust memory.
   */
  async download(
    url: string,
    maxBytes: number,
  ): Promise<{ bytes: Uint8Array; contentType: string | null }> {
    const canvasHost = new URL(this.baseUrl).host;
    let current = new URL(url, this.baseUrl);

    for (let hop = 0; hop < 8; hop++) {
      if (current.protocol !== "https:") {
        throw new Error(`Refusing non-HTTPS download URL (${current.host})`);
      }
      if (
        this.downloadHostSuffixes && current.host !== canvasHost &&
        !this.downloadHostSuffixes.some((sfx) =>
          current.hostname === sfx || current.hostname.endsWith(`.${sfx}`)
        )
      ) {
        throw new Error(`Refusing to download from unexpected host ${current.hostname}`);
      }
      const headers: HeadersInit = current.host === canvasHost
        ? { Authorization: `Bearer ${this.apiToken}`, "User-Agent": USER_AGENT, Accept: "*/*" }
        : { "User-Agent": USER_AGENT, Accept: "*/*" };
      const response = await fetch(current, { headers, redirect: "manual" });

      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location) throw new Error("Download redirect without a Location header");
        current = new URL(location, current);
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(
          `File download failed: ${response.status} ${response.statusText} (from ${current.hostname})`,
        );
      }

      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > maxBytes) {
        await response.body?.cancel();
        throw new Error(`File is larger than the ${Math.round(maxBytes / 1e6)} MB limit`);
      }

      const chunks: Uint8Array[] = [];
      let total = 0;
      if (response.body) {
        for await (const chunk of response.body) {
          total += chunk.byteLength;
          if (total > maxBytes) {
            throw new Error(`File is larger than the ${Math.round(maxBytes / 1e6)} MB limit`);
          }
          chunks.push(chunk);
        }
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.byteLength;
      }
      return { bytes, contentType: response.headers.get("content-type") };
    }
    throw new Error("Too many redirects while downloading file");
  }

  /**
   * Convenience method for GET requests
   */
  async get<T>(
    path: string,
    params?: Record<string, string | string[] | number | boolean | undefined>,
  ): Promise<T> {
    const { data } = await this.fetch<T>(path, { params });
    return data;
  }

  /**
   * Convenience method for GET requests that return arrays (with pagination)
   */
  getAll<T>(
    path: string,
    params?: Record<string, string | string[] | number | boolean | undefined>,
  ): Promise<T[]> {
    return this.fetchAll<T>(path, { params });
  }
}

// Singleton instance for CLI usage
let clientInstance: CanvasClient | null = null;

/**
 * Initialize the singleton client (call once at startup)
 */
export function initClient(options: ClientOptions): CanvasClient {
  clientInstance = new CanvasClient(options);
  return clientInstance;
}

/**
 * Get the singleton client instance
 */
export function getClient(): CanvasClient {
  if (!clientInstance) {
    throw new Error("Canvas client not initialized. Call initClient() first.");
  }
  return clientInstance;
}
