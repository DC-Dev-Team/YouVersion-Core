import fs from "fs";
import path from "path";
import { resolveBook } from "./util";
import type { VersionInfo } from "./types";

// The YouVersion Platform API has no English KJV, so it's served from a
// bundled copy (public domain): db/kjv.json is { "JHN": { "3": { "16": "..." } } }.
type KjvBible = Record<string, Record<string, Record<string, string>>>;

export const KJV_INFO: VersionInfo = {
  id: 1, // bible.com's KJV id; not a YouVersion Platform id
  abbreviation: "KJV",
  title: "King James Version",
  copyright: "Public Domain",
};

export const isLocalKjv = (version: string): boolean =>
  version.trim().toUpperCase() === "KJV";

let kjv: KjvBible | undefined;

// Read on first use (~4 MB) rather than at startup.
const loadKjv = (): KjvBible => {
  kjv ??= JSON.parse(
    fs.readFileSync(path.join(__dirname, "db", "kjv.json"), "utf-8")
  ) as KjvBible;
  return kjv;
};

export const getKjvChapter = (
  bookId: string,
  chapter: string
): Map<number, string> | undefined => {
  const verses = loadKjv()[bookId]?.[String(parseInt(chapter, 10))];
  if (!verses) return undefined;

  return new Map(Object.entries(verses).map(([n, text]) => [Number(n), text]));
};

// Resolves a USFM passage id such as "ISA.12.2", "1JN.2.15-16" or "PSA.23".
export const getKjvPassage = (
  usfm: string
): { reference: string; content: string } | undefined => {
  const match = usfm.match(/^(\w+)\.(\d+)(?:\.(\d+)(?:-(\d+))?)?$/);
  if (!match) return undefined;

  const [, bookId, chapter, start, end] = match;
  const verses = getKjvChapter(bookId, chapter);
  const book = resolveBook(bookId);
  if (!verses || !book) return undefined;

  const from = start ? parseInt(start, 10) : 1;
  const to = end ? parseInt(end, 10) : start ? from : Infinity;
  const text = [...verses]
    .filter(([n]) => n >= from && n <= to)
    .map(([, t]) => t);
  if (!text.length) return undefined;

  const range = start ? `:${start}${end ? `-${end}` : ""}` : "";
  return { reference: `${book.book} ${chapter}${range}`, content: text.join(" ") };
};
