import axios, { AxiosError } from "axios";
import type { AvailableVersion, VersionInfo } from "./types";
import { KJV_INFO } from "./kjv";
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
  title?: string;
  language_tag?: string;
  books?: string[];
}

interface BibleDetails extends BibleSummary {
  title: string;
  copyright: string;
  localized_abbreviation?: string;
  localized_title?: string;
}

const DEFAULT_BIBLE_LANGUAGE = "en";

// YouVersion accepts BCP-47 basic language ranges. Passage selection must be
// a single language (not a wildcard) so duplicate abbreviations are resolved
// deterministically.
const LANGUAGE_RANGE = /^(?:\*|[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)$/;

export const normalizeLanguage = (
  language = DEFAULT_BIBLE_LANGUAGE,
  allowWildcard = false
): string | undefined => {
  const normalized = language.trim();
  if (!normalized || !LANGUAGE_RANGE.test(normalized)) return undefined;
  if (!allowWildcard && normalized === "*") return undefined;
  return normalized === "*" ? normalized : normalized.toLowerCase();
};

export const isEnglishLanguage = (language: string): boolean =>
  language.toLowerCase() === "en" || language.toLowerCase().startsWith("en-");

// Language-scoped Bible catalogues the app key can use. Refreshed daily;
// licences are managed on platform.youversion.com.
const BIBLES_TTL_MS = 24 * 60 * 60 * 1000;
const biblesRequests = new Map<
  string,
  { fetchedAt: number; request: Promise<BibleSummary[]> }
>();

const fetchAvailableBibles = async (
  language: string,
  includeBooks: boolean
): Promise<BibleSummary[]> => {
  const bibles: BibleSummary[] = [];
  let pageToken: string | undefined;

  do {
    const page = await yvpGet<
      { data: BibleSummary[]; next_page_token?: string } | ""
    >(
      "/bibles",
      {
        language_ranges: [language],
        // YouVersion permits page_size=* only for up to three fields.
        fields: includeBooks
          ? ["id", "abbreviation", "books"]
          : ["id", "abbreviation", "title", "language_tag"],
        page_size: includeBooks ? "*" : 99,
        ...(pageToken ? { page_token: pageToken } : {}),
      }
    );

    // 204 No Content (empty body) means no Bibles for the language.
    if (!page) break;

    bibles.push(...(page.data ?? []));
    pageToken = page.next_page_token || undefined;
  } while (pageToken);

  return bibles;
};

export const getAvailableBibles = (
  language = DEFAULT_BIBLE_LANGUAGE,
  includeBooks = false
): Promise<BibleSummary[]> => {
  const cacheKey = `${language}:${includeBooks ? "books" : "catalogue"}`;
  const cached = biblesRequests.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt <= BIBLES_TTL_MS) {
    return cached.request;
  }

  const request = fetchAvailableBibles(language, includeBooks);
  biblesRequests.set(cacheKey, { fetchedAt: Date.now(), request });
  request.catch(() => biblesRequests.delete(cacheKey));
  return request;
};

export const listAvailableVersions = async (
  language = DEFAULT_BIBLE_LANGUAGE
): Promise<AvailableVersion[]> => {
  const normalized = normalizeLanguage(language, true);
  if (!normalized) throw new YvpError(400, `Invalid language range '${language}'.`);

  const upstream = getAppKey() ? await getAvailableBibles(normalized) : [];
  const versions: AvailableVersion[] = upstream.map((bible) => {
    if (!bible.title) throw new YvpError(502, `Missing title for Bible ${bible.id}.`);
    return {
      id: bible.id,
      abbreviation: bible.abbreviation,
      title: bible.title,
      languageTag: bible.language_tag ?? normalized,
      source: "youversion",
    };
  });

  if (normalized === "*" || isEnglishLanguage(normalized)) {
    versions.unshift({
      id: KJV_INFO.id,
      abbreviation: KJV_INFO.abbreviation,
      title: KJV_INFO.title,
      languageTag: "en",
      source: "local",
    });
  }

  return versions;
};

// Maps "KJV" / "niv" / "3034" onto an id the app key can use. Numeric input
// is passed through as a YouVersion Platform Bible id.
// Common names for versions whose Platform abbreviation differs.
const VERSION_ALIASES: Record<string, string> = {
  NIV: "NIV11",
  NIVUK: "NIVUK11",
};

export const resolveVersionId = async (
  version: string | undefined,
  language = DEFAULT_BIBLE_LANGUAGE,
  bookId?: string
): Promise<{ id: number; abbreviation: string } | { code: number; message: string }> => {
  const normalized = normalizeLanguage(language);
  if (!normalized) {
    return { code: 400, message: `Invalid language '${language}'.` };
  }

  const bibles = await getAvailableBibles(normalized, !version && !!bookId);
  const byAbbreviation = new Map<string, number>();
  for (const bible of bibles) {
    const key = bible.abbreviation?.toUpperCase();
    if (key && !byAbbreviation.has(key)) byAbbreviation.set(key, bible.id);
  }

  const input = version?.trim().toUpperCase();

  if (!input) {
    const first = bookId
      ? bibles.find((bible) => bible.books?.includes(bookId))
      : bibles[0];
    if (first) return { id: first.id, abbreviation: first.abbreviation };
    return {
      code: 400,
      message: bookId
        ? `No Bible versions containing '${bookId}' are available for language '${normalized}'.`
        : `No Bible versions are available for language '${normalized}'.`,
    };
  }

  if (/^\d+$/.test(input)) {
    const id = parseInt(input, 10);
    const abbreviation = bibles.find((bible) => bible.id === id)?.abbreviation;
    if (abbreviation) return { id, abbreviation };
  } else {
    const abbreviation = byAbbreviation.has(input) ? input : VERSION_ALIASES[input];
    const id = abbreviation ? byAbbreviation.get(abbreviation) : undefined;
    if (id !== undefined) return { id, abbreviation };
  }

  const local = isEnglishLanguage(normalized) ? ["KJV"] : [];
  const available = [...new Set([...byAbbreviation.keys(), ...local])].sort();
  return {
    code: 400,
    message:
      `Bible version '${version}' is not available for language '${normalized}' and this app key. ` +
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
    const bible = await yvpGet<BibleDetails>(`/bibles/${versionId}`);
    const info: VersionInfo = {
      id: bible.id,
      abbreviation: bible.abbreviation,
      title: bible.title,
      copyright: bible.copyright,
      languageTag: bible.language_tag,
      localizedAbbreviation: bible.localized_abbreviation,
      localizedTitle: bible.localized_title,
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
