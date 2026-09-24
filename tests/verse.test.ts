import { getVerse } from "../src/verse";
import { expect, it, describe } from "vitest";
import type { FullChapterResult, VerseRangeResult } from "../src/types";

const expectFullChapter = (result: any): result is FullChapterResult => {
  return "verses" in result && "title" in result;
};

const expectVerseRange = (result: any): result is VerseRangeResult => {
  return "verses" in result && !("title" in result);
};

// KJV is served from the bundled db/kjv.json, so these need no app key.
describe("getVerse (local KJV)", () => {
  it("Psalms 23 (full chapter)", async () => {
    const result = await getVerse("Psalms", "23", "-1", "KJV");

    if (!expectFullChapter(result)) {
      throw new Error("Expected full chapter result");
    }

    expect(result.citation).toBe("Psalms 23");
    expect(result.title).toBe("Psalms 23");
    expect(result.verses[1]).toBe("The LORD is my shepherd; I shall not want.");
    expect(Object.keys(result.verses)).toHaveLength(6);
    expect(result.version?.abbreviation).toBe("KJV");
  });

  it("John 3:16 (single verse, lower-case version)", async () => {
    const result = await getVerse("JHN", "3", "16", "kjv");

    if (!expectVerseRange(result)) {
      throw new Error("Expected verse range result");
    }

    expect(result.citation).toBe("John 3:16");
    expect(result.verses[16]).toBe(
      "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life."
    );
  });

  it("Genesis 1:1-3,5 (range and list)", async () => {
    const result = await getVerse("Genesis", "1", "1-3,5", "KJV");

    if (!expectVerseRange(result)) {
      throw new Error("Expected verse range result");
    }

    expect(Object.keys(result.verses)).toEqual(["1", "2", "3", "5"]);
    expect(result.verses[1]).toBe(
      "In the beginning God created the heaven and the earth."
    );
  });

  it("Invalid book returns error", async () => {
    const result = await getVerse("InvalidBook", "1", "-1", "KJV");
    expect(result).toHaveProperty("code", 400);
    expect((result as any).message).toContain("Could not find book");
  });

  it("Invalid verse and chapter return errors", async () => {
    expect(await getVerse("John", "1", "999", "KJV")).toEqual({
      code: 400,
      message: "Verse not found.",
    });
    expect(await getVerse("John", "30", "-1", "KJV")).toEqual({
      code: 400,
      message: "Verse not found.",
    });
  });
});

// Hits the live YouVersion Platform API, so it needs an app key with the
// public-domain BSB and ASV enabled.
describe.skipIf(!process.env.YOU_VERSION_API_KEY)("getVerse (YouVersion)", () => {
  it("John 1 (full chapter, BSB)", async () => {
    const result = await getVerse("John", "1", "-1", "BSB");

    if (!expectFullChapter(result)) {
      throw new Error("Expected full chapter result");
    }

    expect(result.citation).toBe("John 1");
    expect(result.title).toBe("The Beginning");
    expect(result.verses[1]).toBe(
      "In the beginning was the Word, and the Word was with God, and the Word was God."
    );
    expect(Object.keys(result.verses).length).toBeGreaterThanOrEqual(51);
    expect(result.version?.abbreviation).toBe("BSB");
  }, 10_000);

  it("John 3:16 (single verse, ASV)", async () => {
    const result = await getVerse("John", "3", "16", "ASV");

    if (!expectVerseRange(result)) {
      throw new Error("Expected verse range result");
    }

    expect(result.citation).toBe("John 3:16");
    expect(Object.keys(result.verses)).toEqual(["16"]);
    expect(result.verses[16]).toContain("For God so loved the world");
  }, 10_000);

  it("NIV alias resolves to NIV11", async () => {
    const result = await getVerse("John", "3", "16", "niv");

    if (!expectVerseRange(result)) {
      throw new Error("Expected verse range result");
    }

    expect(result.version?.id).toBe(111);
    expect(result.verses[16]).toContain("For God so loved the world");
  }, 10_000);

  it("Unavailable version returns error", async () => {
    const result = await getVerse("John", "3", "16", "NOT-A-VERSION");
    expect(result).toHaveProperty("code", 400);
    expect((result as any).message).toContain("is not available");
  }, 10_000);

  it("Invalid verse returns error", async () => {
    const result = await getVerse("John", "1", "999", "BSB");
    expect(result).toHaveProperty("code", 400);
    expect((result as any).message).toBe("Verse not found.");
  }, 10_000);
});
