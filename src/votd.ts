import { getPassage, resolveVersionId, yvpGet, YvpError } from "./yvp";

export interface VotdResult {
  citation: string;
  passage: string;
  images: string[];
  version: string;
}

const dayOfYear = (date = new Date()): number => {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86_400_000);
};

// First Bible the app key can use in the given language (e.g. "en", "de").
const firstBibleForLanguage = async (
  language: string
): Promise<{ id: number; abbreviation: string } | undefined> => {
  try {
    const { data } = await yvpGet<{
      data: { id: number; abbreviation: string }[];
    }>("/bibles", { "language_ranges[]": language, page_size: 1 });
    return data[0];
  } catch (err) {
    if (err instanceof YvpError && err.status < 500) return undefined;
    throw err;
  }
};

/**
 * YouVersion's verse of the day. `lang` may be a comma separated list; the
 * first language with an available Bible is used. Pass `version` (e.g. "KJV"
 * or 1) to pick the Bible explicitly instead.
 */
export const getVotd = async (
  lang: string,
  version?: string
): Promise<VotdResult | undefined> => {
  const { passage_id } = await yvpGet<{ day: number; passage_id: string }>(
    `/verse_of_the_days/${dayOfYear()}`
  );

  let bible: { id: number; abbreviation?: string } | undefined;
  if (version) {
    const resolved = await resolveVersionId(version);
    if ("code" in resolved) throw new YvpError(resolved.code, resolved.message);
    bible = resolved;
  } else {
    for (const language of lang.split(",").map((l) => l.trim())) {
      bible = language ? await firstBibleForLanguage(language) : undefined;
      if (bible) break;
    }
  }
  if (!bible) return undefined;

  const passage = await getPassage(bible.id, passage_id, "text");

  return {
    citation: passage.reference,
    passage: passage.content.replace(/\s+/g, " ").trim(),
    images: [],
    version: bible.abbreviation ?? String(bible.id),
  };
};
