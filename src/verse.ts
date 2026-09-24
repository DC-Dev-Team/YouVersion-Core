import * as cheerio from "cheerio";
import { resolveBook } from "./util";
import {
  getPassage,
  getVersionInfo,
  resolveVersionId,
  toApiError,
} from "./yvp";
import type {
  GetVerseResult,
  FullChapterResult,
  VerseRangeResult,
} from "./types";

const cleanText = (html: string): string => {
  return html
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s+([)"”'’\]\}])/g, "$1")
    .replace(/([.,;:!?'"”’\)\]\}])(?=[A-Za-z0-9(\[\{])/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
};

// Passage HTML marks each verse with <span class="yv-v" v="N"></span>.
const VERSE_MARKER = /<span class="yv-v" v="(\d+)"><\/span>/g;

// Headings (.yv-h), footnotes (.yv-n) and verse labels aren't verse text.
const verseText = (html: string): string => {
  const $ = cheerio.load(html);
  $(".yv-h, .yv-n, .yv-vlbl").remove();
  return cleanText($.root().text());
};

const splitVerses = (html: string): Map<number, string> => {
  const markers = [...html.matchAll(VERSE_MARKER)];
  const result = new Map<number, string>();

  markers.forEach((match, i) => {
    const start = match.index ?? 0;
    const end = markers[i + 1]?.index ?? html.length;
    const text = verseText(html.slice(start, end));
    if (text) result.set(parseInt(match[1], 10), text);
  });

  return result;
};

export const getVerse = async (
  book: string,
  chapter: string,
  verses: string,
  version: string
): Promise<GetVerseResult> => {
  const bookInfo = resolveBook(book);

  if (!bookInfo) {
    return {
      code: 400,
      message: `Could not find book '${book}' by name or alias.`,
    };
  }

  // Always fetch the whole chapter and pick the requested verses out of it,
  // so single verses, ranges ("4-13") and lists ("3,5,7-10") all work.
  const usfm = `${bookInfo.aliases[0]}.${chapter}`;
  const fullChapter = verses === "-1";

  let versionId: number | undefined;

  try {
    const resolved = await resolveVersionId(version);
    if ("code" in resolved) return resolved;
    versionId = resolved.id;

    const [passage, versionInfo] = await Promise.all([
      getPassage(versionId, usfm, "html", true),
      getVersionInfo(versionId),
    ]);

    const allVerses = splitVerses(passage.content);
    const versesObj: Record<number, string> = {};
    for (const [n, text] of allVerses) {
      if (fullChapter || matchesRange(verses, n)) versesObj[n] = text;
    }

    if (!Object.keys(versesObj).length)
      return { code: 400, message: "Verse not found." };

    if (fullChapter) {
      const title =
        cheerio.load(passage.content)(".yv-h").first().text().trim() ||
        passage.reference ||
        `${bookInfo.book} ${chapter}`;

      return {
        title,
        verses: versesObj,
        citation: `${bookInfo.book} ${chapter}`,
        version: versionInfo,
      } as FullChapterResult;
    }

    return {
      verses: versesObj,
      citation: `${bookInfo.book} ${chapter}:${verses}`,
      version: versionInfo,
    } as VerseRangeResult;
  } catch (err) {
    console.error(`Error fetching ${usfm} (version ${versionId}):`, err);
    return toApiError(err);
  }
};

// Supports a single verse ("5"), a range ("4-13") or a list ("3,5,7-10").
function matchesRange(input: string, num: number): boolean {
  const parts = input.split(",").map((p) => p.trim());

  for (const part of parts) {
    if (/^\d+$/.test(part) && num === parseInt(part, 10)) return true;

    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (num >= start && num <= end) return true;
    }
  }

  return false;
}
