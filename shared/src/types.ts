/**
 * Shared types used by both the Lambda handlers and the frontend, so the
 * API contract between them can't silently drift. Imported as
 * "@bulk-email-tool/shared" from either package.
 */

/**
 * The named mailing lists subscribers can belong to. Edit this to match
 * your actual groups (e.g. tennis coaching lesson types, skill levels) —
 * this drives the "send to" dropdown on the compose page, and the
 * import script warns about any list name in your CSV/Excel file that
 * isn't listed here.
 */
export const AVAILABLE_LISTS = ["TEST", "League", "general", "juniors", "adults"] as const;
export type ListName = (typeof AVAILABLE_LISTS)[number];

export interface Subscriber {
  email: string;
  subscribed: boolean;
  unsubscribeToken: string;
  createdAt: string;
  /** Which named lists this subscriber belongs to. */
  lists: string[];
}

/** Query params of GET /unsubscribe?email=...&token=... */
export interface UnsubscribeQueryParams {
  email: string;
  token: string;
}

export interface UnsubscribeResponseBody {
  ok: boolean;
  message: string;
}

/**
 * Body of POST /campaigns (admin-only, requires the x-admin-key header).
 * listName omitted or "all" sends to every subscribed address; otherwise
 * only to subscribers whose `lists` array includes that name.
 */
export interface SendCampaignRequestBody {
  subject: string;
  html: string;
  text?: string;
  listName?: string | "all";
}

export interface SendCampaignResponseBody {
  ok: boolean;
  message: string;
}
