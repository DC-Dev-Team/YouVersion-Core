import axios from "axios";
import * as cheerio from "cheerio";

const versions = require("../db/versions.json");
const bookList = require("../db/books.json");
const baseURL = "https://www.bible.com/bible";

type bookType = {
  book: String;
  aliases: Array<String>;
  chapters: Number;
};

export const getVerse = async (
  book: string,
  chapter: string,
  verses: string,
  version: string
) => {
  let versionFinder: any = {
    version: (function () {
      const parsedVersion: number = parseInt(version, 10);

      if (!isNaN(parsedVersion)) {
        return parsedVersion;
      } else {
        return (
          Object.keys(versions).find(
            (key) => key.toLocaleUpperCase() === version.toLocaleUpperCase()
          ) ?? "NIV"
        );
      }
    })(),
    id: (function () {
      const parsedVersion = parseInt(version, 10);

      if (!isNaN(parsedVersion)) {
        return parsedVersion;
      } else {
        const versionKey = Object.keys(versions).find(
          (key) => key.toUpperCase() === version.toUpperCase()
        );
        return versionKey ? versions[versionKey] : 111;
      }
    })(),
  };

  let bookFinder =
    bookList.books.find(
      (o: bookType) => o.book.toLowerCase() === book.toLowerCase()
    ) ||
    bookList.books.find((o: bookType) =>
      o.aliases.includes(book.toUpperCase())
    );
  if (!bookFinder)
    return {
      code: 400,
      message: `Could not find book '${book}' by name or alias.`,
    };

  let URL;
  verses == "-1"
    ? (URL = `${baseURL}/${versionFinder.id}/${bookFinder.aliases[0]}.${chapter}`)
    : (URL = `${baseURL}/${versionFinder.id}/${bookFinder.aliases[0]}.${chapter}.${verses}`);

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

      if (verses == "-1") {
        const fullChapter = cheerio
          .load(json.props.pageProps.chapterInfo.content)
          .html();

        // Split each verse into an array.
        const paverses = fullChapter.split(
          /<span class="label">[0-9]*<\/span>/g
        );
        let title = cheerio.load(paverses[0])(".heading").text();
        paverses.shift();

        // Verses" { "1": "...", "2": "...", ... }
        paverses.forEach((verse: string, index: number) => {
          const verseNumber = index + 1;

          verse = cheerio.load(verse)(".content").text();
          verse = verse.replace(/\n/g, " ").trim();

          versesArray.push({
            verseNumber: verseNumber,
            verseContent: verse,
          });
        });

        const versesObject = versesArray.reduce(
          (acc: { [key: number]: string }, verse) => {
            acc[verse.verseNumber] = verse.verseContent;
            return acc;
          },
          {}
        );

        return {
          title: title,
          verses: versesObject,
          citation: `${bookFinder.book} ${chapter}`,
        };
      } else {
        const verse = json.props.pageProps.verses[0].content;
        const reference = json.props.pageProps.verses[0].reference.human;

        return {
          citation: `${reference}`,
          passage: verse,
        };
      }
    }
    // Old way :(
    else {
      const versesArray: Array<String> = [];
      const wrapper = $(".text-17");

      await wrapper.each((i, p) => {
        let unformattedVerse = $(p).eq(0).text();
        let formattedVerse = unformattedVerse.replace(/\n/g, " ");
        versesArray.push(formattedVerse);
      });

      return {
        citation: `${bookFinder.book} ${chapter}:${verses}`,
        passage: versesArray[0],
      };
    }
  } catch (err) {
    console.error(err);
  }
};
