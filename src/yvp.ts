import axios, { AxiosError } from "axios";
import type { VersionInfo } from "./types";
import { createPassageCache, TtlCache } from "./cache";

// YouVersion Platform API: https://developers.youversion.com
const API_BASE = "https://api.youversion.com/v1";

export class YvpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const getAppKey = (): string | undefined => process.env.YOU_VERSION_API_KEY;

export const yvpGet = async <T>(
  path: string,
  params?: Record<string, string | number | boolean | string[]>
): Promise<T> => {
  const appKey = getAppKey();
  if (!appKey) throw new YvpError(500, "YOU_VERSION_API_KEY is not set.");

  try {
    const { data } = await axios.get<T>(`${API_BASE}${path}`, {
      params,
      timeout: 8000,
      headers: {
        "X-YVP-App-Key": appKey,
        Accept: "application/json",
      },
    });
    return data;
  } catch (err) {
    if (err instanceof AxiosError && err.response) {
      throw new YvpError(
        err.response.status,
        `YouVersion API responded ${err.response.status} for ${path}`
      );
    }
    throw err;
  }
};

interface BiblePassage {
  id: string;
  content: string;
  reference: string;
}

// Created on first use so VERSE_CACHE_* from .env is loaded by then.
let passageCache: TtlCache<Promise<BiblePassage>> | undefined;

// Caches the in-flight promise too, so concurrent requests for the same
// chapter share one upstream call. Failures are evicted so they can retry.
export const getPassage = (
  versionId: number,
  usfm: string,
  format: "html" | "text",
  includeHeadings = false
): Promise<BiblePassage> => {
  passageCache ??= createPassageCache<Promise<BiblePassage>>();

  const key = `${versionId}:${usfm}:${format}:${includeHeadings}`;
  const cached = passageCache.get(key);
  if (cached) return cached;

  const request = yvpGet<BiblePassage>(`/bibles/${versionId}/passages/${usfm}`, {
    format,
    include_headings: includeHeadings,
  });
  passageCache.set(key, request);
  request.catch(() => passageCache?.delete(key));

  return request;
};

interface BibleSummary {
  id: number;
  abbreviation: string;
}

// Only English Bibles are served. Abbreviations are not unique across
// languages (e.g. "KJV" is also the Thai KJV), so matching is restricted.
const BIBLE_LANGUAGE = "en";

// Bibles the app key can use, keyed by upper-cased abbreviation. Refreshed
// daily; licences are managed on platform.youversion.com.
const BIBLES_TTL_MS = 24 * 60 * 60 * 1000;
let biblesRequest: Promise<Map<string, number>> | undefined;
let biblesFetchedAt = 0;

const fetchAvailableBibles = async (): Promise<Map<string, number>> => {
  const byAbbreviation = new Map<string, number>();
  let pageToken: string | undefined;

  do {
    const page = await yvpGet<
      { data: BibleSummary[]; next_page_token?: string } | ""
    >(
      "/bibles",
      {
        // Arrays serialize as language_ranges[]=en&fields[]=id&...
        language_ranges: [BIBLE_LANGUAGE],
        fields: ["id", "abbreviation"],
        page_size: "*",
        ...(pageToken ? { page_token: pageToken } : {}),
      }
    );

    // 204 No Content (empty body) means no Bibles for the language.
    if (!page) break;

    for (const bible of page.data ?? []) {
      const key = bible.abbreviation?.toUpperCase();
      if (key && !byAbbreviation.has(key)) byAbbreviation.set(key, bible.id);
    }
    pageToken = page.next_page_token || undefined;
  } while (pageToken);

  return byAbbreviation;
};

export const getAvailableBibles = (): Promise<Map<string, number>> => {
  if (!biblesRequest || Date.now() - biblesFetchedAt > BIBLES_TTL_MS) {
    biblesFetchedAt = Date.now();
    biblesRequest = fetchAvailableBibles();
    biblesRequest.catch(() => (biblesRequest = undefined));
  }
  return biblesRequest;
};

// Maps "KJV" / "niv" / "3034" onto an id the app key can use. Numeric input
// is passed through as a YouVersion Platform Bible id.
export const resolveVersionId = async (
  version: string
): Promise<{ id: number; abbreviation: string } | { code: number; message: string }> => {
  const bibles = await getAvailableBibles();
  const input = version.trim().toUpperCase();

  if (/^\d+$/.test(input)) {
    const id = parseInt(input, 10);
    const abbreviation = [...bibles].find(([, v]) => v === id)?.[0];
    if (abbreviation) return { id, abbreviation };
  } else {
    const id = bibles.get(input);
    if (id !== undefined) return { id, abbreviation: input };
  }

  // KJV is served locally (see kjv.ts), so it is always available.
  const available = [...new Set([...bibles.keys(), "KJV"])].sort();
  return {
    code: 400,
    message:
      `English Bible version '${version}' is not available for this app key. ` +
      (available.length
        ? `Available: ${available.join(", ")}.`
        : "No Bibles are enabled for this key; enable some on platform.youversion.com."),
  };
};

// Version metadata rarely changes, so keep it for the life of the process.
const versionCache = new Map<number, VersionInfo>();

// Attribution (abbreviation + copyright) should accompany displayed text.
// Returns undefined rather than failing the whole request if it can't load.
export const getVersionInfo = async (
  versionId: number
): Promise<VersionInfo | undefined> => {
  const cached = versionCache.get(versionId);
  if (cached) return cached;

  try {
    const bible = await yvpGet<VersionInfo & Record<string, unknown>>(
      `/bibles/${versionId}`
    );
    const info: VersionInfo = {
      id: bible.id,
      abbreviation: bible.abbreviation,
      title: bible.title,
      copyright: bible.copyright,
    };
    versionCache.set(versionId, info);
    return info;
  } catch (err) {
    console.error(`Could not load metadata for version ${versionId}:`, err);
    return undefined;
  }
};

// Maps an upstream failure onto the { code, message } errors the API returns.
export const toApiError = (err: unknown): { code: number; message: string } => {
  if (!getAppKey()) return { code: 500, message: "YOU_VERSION_API_KEY is not set." };

  if (err instanceof YvpError) {
    switch (err.status) {
      case 401:
        return { code: 500, message: "YOU_VERSION_API_KEY was rejected by YouVersion." };
      case 403:
        return {
          code: 403,
          message: "This Bible version is not licensed for the configured app key.",
        };
      case 404:
        return { code: 400, message: "Verse not found." };
    }
    return { code: 502, message: err.message };
  }
  return { code: 502, message: "Failed to fetch verse data." };
};
