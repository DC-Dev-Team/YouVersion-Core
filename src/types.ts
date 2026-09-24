export interface Verse {
  verseNumber: number;
  verseContent: string;
}

export interface VersionInfo {
  id: number;
  abbreviation: string;
  title: string;
  copyright: string;
}

export interface FullChapterResult {
  title: string;
  verses: Record<number, string>;
  citation: string;
  version?: VersionInfo;
}

export interface SingleVerseResult {
  citation: string;
  passage: string;
}

export interface VerseRangeResult {
  verses: Record<number, string>;
  citation: string;
  version?: VersionInfo;
}

export interface BookInfo {
  book: string;
  aliases: string[];
  chapters: number;
}

export type GetVerseSuccess =
  | FullChapterResult
  | SingleVerseResult
  | VerseRangeResult;
export type GetVerseError = { code: number; message: string };
export type GetVerseResult = GetVerseSuccess | GetVerseError;
