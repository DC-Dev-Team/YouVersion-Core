import { getVotd } from "../src/votd";
import { expect, it, describe } from "vitest";

// Hits the live YouVersion Platform API, so it needs an app key.
describe.skipIf(!process.env.YOU_VERSION_API_KEY)("getVotd", () => {
  it("VOTD", async () => {
    const verse = await getVotd("en");
    const verse2 = await getVotd("coffee");

    expect(verse?.citation).toBeDefined();
    expect(verse?.passage).toBeDefined();

    expect(verse2).toBeUndefined();
  });
});
