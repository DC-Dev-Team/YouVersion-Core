import axios from "axios";
import * as cheerio from "cheerio";

const versions = require("../db/versions.json");
const bookList = require("../db/books.json");
const baseURL = "https://www.bible.com/bible";

type bookType = {
  book: string;
  aliases: string[];
  chapters: number;
};

export const getVerse = async (
  book: string,
  chapter: string,
  verses: string,
  version: string,
) => {
  let versionFinder: any = {
    version: (function () {
      const parsedVersion: number = parseInt(version, 10);

      if (!isNaN(parsedVersion)) {
        return parsedVersion;
      } else {
        return (
          Object.keys(versions).find(
            (key) => key.toLocaleUpperCase() === version.toLocaleUpperCase(),
          ) ?? "KJV"
        );
      }
    })(),
    id: (function () {
      const parsedVersion = parseInt(version, 10);

      if (!isNaN(parsedVersion)) {
        return parsedVersion;
      } else {
        const versionKey = Object.keys(versions).find(
          (key) => key.toUpperCase() === version.toUpperCase(),
        );
        return versionKey ? versions[versionKey] : 111;
      }
    })(),
  };

  let bookFinder =
    bookList.books.find(
      (o: bookType) => o.book.toLowerCase() === book.toLowerCase(),
    ) ||
    bookList.books.find((o: bookType) =>
      o.aliases.includes(book.toUpperCase()),
    );
  if (!bookFinder)
    return {
      code: 400,
      message: `Could not find book '${book}' by name or alias.`,
    };

  let URL = `${baseURL}/${versionFinder.id}/${bookFinder.aliases[0]}.${chapter}`;

  interface verseType {
    verseNumber: number;
    verseContent: string;
  }
  const versesArray: verseType[] = [];

  try {
    const { data } = await axios.get(URL);
    const $ = cheerio.load(data);

    const unavailable = $("p:contains('No Available Verses')").text();
    if (unavailable) return { code: 400, message: "Verse not found" };

    // Nextjs way :)
    const nextWay = $("script#__NEXT_DATA__").eq(0);
    if (nextWay) {
      let json = JSON.parse(nextWay.html() || "");

      const fullChapter = cheerio
        .load(json.props.pageProps.chapterInfo.content)
        .html();

      // Split each verse into an array.
      const paverses = fullChapter.split(/<span class="label">[0-9]*<\/span>/g);
      paverses.shift();

      // Build verses
      paverses.forEach((verse: string, index: number) => {
        const verseNumber = index + 1;

        verse = cheerio.load(verse)(".content").text();
        verse = verse.replace(/\n/g, " ").trim();

        if (matchesRange(verses, verseNumber)) {
          versesArray.push({
            verseNumber,
            verseContent: verse,
          });
        }
      });

      const versesObject = versesArray.reduce(
        (acc: { [key: number]: string }, verse) => {
          acc[verse.verseNumber] = verse.verseContent;
          return acc;
        },
        {},
      );

      return {
        verses: versesObject,
        citation: `${bookFinder.book} ${chapter}:${verses}`,
      };
    }
    // Old way :(
    else {
      const fallbackVerses: verseType[] = [];
      const wrapper = $(".text-17");

      wrapper.each((i, p) => {
        let unformattedVerse = $(p).eq(0).text();
        let formattedVerse = unformattedVerse.replace(/\n/g, " ").trim();

        if (matchesRange(verses, i + 1)) {
          fallbackVerses.push({
            verseNumber: i + 1,
            verseContent: formattedVerse,
          });
        }
      });

      const versesObject = fallbackVerses.reduce(
        (acc: { [key: number]: string }, verse) => {
          acc[verse.verseNumber] = verse.verseContent;
          return acc;
        },
        {},
      );

      return {
        citation: `${bookFinder.book} ${chapter}:${verses}`,
        verses: versesObject,
      };
    }
  } catch (err) {
    console.error(err);
  }
};

function matchesRange(input: string, num: number): boolean {
  // Split on commas to support lists like "3,5,7-10"
  const parts = input.split(",").map((p) => p.trim());

  for (const part of parts) {
    // Case: single number (e.g. "5")
    if (/^\d+$/.test(part)) {
      if (num === parseInt(part, 10)) {
        return true;
      }
    }

    // Case: range (e.g. "4-13")
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (num >= start && num <= end) {
        return true;
      }
    }
  }

  return false;
}
