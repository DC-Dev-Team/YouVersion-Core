import { afterEach, describe, expect, it, vi } from "vitest";
import { getVerse } from "../src/verse";
import {
  listAvailableVersions,
  normalizeLanguage,
} from "../src/yvp";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("language ranges", () => {
  it("normalizes BCP-47 language tags", () => {
    expect(normalizeLanguage("EN-us")).toBe("en-us");
    expect(normalizeLanguage("yo")).toBe("yo");
    expect(normalizeLanguage("*", true)).toBe("*");
    expect(normalizeLanguage("*")).toBeUndefined();
    expect(normalizeLanguage("not a language")).toBeUndefined();
  });

  it("rejects invalid passage languages", async () => {
    const result = await getVerse("John", "3", "16", "KJV", "not a language");
    expect(result).toEqual({
      code: 400,
      message: "Invalid language 'not a language'.",
    });
  });
});

describe("available versions", () => {
  it("lists bundled English KJV when no app key is configured", async () => {
    vi.stubEnv("YOU_VERSION_API_KEY", "");

    await expect(listAvailableVersions("en")).resolves.toEqual([
      {
        id: 1,
        abbreviation: "KJV",
        title: "King James Version",
        languageTag: "en",
        source: "local",
      },
    ]);
  });

  it("does not advertise English KJV for another language", async () => {
    vi.stubEnv("YOU_VERSION_API_KEY", "");
    await expect(listAvailableVersions("es")).resolves.toEqual([]);
  });
});

describe.skipIf(!process.env.YOU_VERSION_API_KEY)("multilingual YouVersion", () => {
  it("lists Spanish versions and fetches a Spanish passage", async () => {
    const versions = await listAvailableVersions("es");
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.every((version) => version.title.trim().length > 0)).toBe(true);
    expect(versions.every((version) => version.languageTag.startsWith("es"))).toBe(true);

    const result = await getVerse(
      "JHN",
      "3",
      "16",
      undefined,
      "es"
    );
    expect(result).toHaveProperty("verses.16");
  }, 10_000);
});
