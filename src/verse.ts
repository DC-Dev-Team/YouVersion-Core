import axios from "axios";
import * as cheerio from "cheerio";
import { resolveVersion, resolveBook } from "./util";
import type {
  GetVerseResult,
  FullChapterResult,
  VerseRangeResult,
} from "./types";

const BASE_URL = "https://www.bible.com/bible";

const cleanText = (html: string): string => {
  return html
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s+([)"”'’\]\}])/g, "$1")
    .replace(/([.,;:!?'"”’\)\]\}])(?=[A-Za-z0-9(\[\{])/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
};

export const getVerse = async (
  book: string,
  chapter: string,
  verses: string,
  version: string
): Promise<GetVerseResult> => {
  const { id: versionId } = resolveVersion(version);
  const bookInfo = resolveBook(book);

  if (!bookInfo) {
    return {
      code: 400,
      message: `Could not find book '${book}' by name or alias.`,
    };
  }

  // Always fetch the whole chapter and pick the requested verses out of it,
  // so single verses, ranges ("4-13") and lists ("3,5,7-10") all work.
  const alias = bookInfo.aliases[0];
  const url = `${BASE_URL}/${versionId}/${alias}.${chapter}`;
  const fullChapter = verses === "-1";

  try {
    const { data } = await axios.get<string>(url, {
      timeout: 8000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 11.00; Win64; x64; rv:10.0) Gecko/20100101 Firefox/10.0",
      },
    });

    const $ = cheerio.load(data);

    if ($("p:contains('No Available Verses')").length) {
      return { code: 400, message: "Verse not found." };
    }

    const nextScript = $("script#__NEXT_DATA__").first();
    if (nextScript.length) {
      const json = JSON.parse(nextScript.html() || "");

      const chapterHtml = json.props.pageProps.chapterInfo?.content;
      if (!chapterHtml)
        return { code: 400, message: "Chapter content not found." };

      const chapter$ = cheerio.load(chapterHtml);
      let title =
        chapter$(".heading").first().text().trim() ||
        chapter$(".d").first().text().trim() ||
        `${bookInfo.book} ${chapter}`;

      const versesArray: { verseNumber: number; verseContent: string }[] = [];

      const paverses = chapterHtml.split(/<span class="label">\d+<\/span>/g);
      let titleText = cheerio.load(paverses[0])(".heading").text();
      paverses.shift();

      paverses.forEach((verse: any, index: number) => {
        const verseNumber = index + 1;
        if (!fullChapter && !matchesRange(verses, verseNumber)) return;

        let verseText = cheerio.load(verse)(".content").text();
        verseText = cleanText(verseText);

        if (verseText)
          versesArray.push({
            verseNumber,
            verseContent: verseText,
          });
      });

      const versesObj = versesArray.reduce(
        (acc: Record<number, string>, verse) => {
          acc[verse.verseNumber] = verse.verseContent;
          return acc;
        },
        {}
      );

      if (!fullChapter) {
        if (!versesArray.length)
          return { code: 400, message: "Verse not found." };

        return {
          verses: versesObj,
          citation: `${bookInfo.book} ${chapter}:${verses}`,
        } as VerseRangeResult;
      }

      return {
        title: titleText || title,
        verses: versesObj,
        citation: `${bookInfo.book} ${chapter}`,
      } as FullChapterResult;
    }

    const wrapper = $(".text-17");

    // Neither the Next.js payload nor the legacy markup is present, e.g.
    // bible.com served a bot "Client Challenge" page instead of the chapter.
    if (!wrapper.length) {
      const pageTitle = $("title").text().trim();
      console.error(
        `Unexpected page from ${url}${pageTitle ? ` ("${pageTitle}")` : ""}`
      );
      return {
        code: 502,
        message: "bible.com returned an unexpected page (possibly blocked).",
      };
    }

    const versesObj: Record<number, string> = {};

    wrapper.each((i, p) => {
      const verseNumber = i + 1;
      if (!fullChapter && !matchesRange(verses, verseNumber)) return;

      const text = cleanText($(p).text());
      if (text) versesObj[verseNumber] = text;
    });

    return {
      verses: versesObj,
      citation: fullChapter
        ? `${bookInfo.book} ${chapter}`
        : `${bookInfo.book} ${chapter}:${verses}`,
    } as VerseRangeResult;
  } catch (err) {
    console.error("Error fetching or parsing verse:", err);
    return { code: 400, message: "Failed to fetch or parse verse data." };
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
