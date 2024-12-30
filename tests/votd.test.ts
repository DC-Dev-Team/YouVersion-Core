import { getVotd } from "../functions/votd";
import { expect, it, describe } from "vitest";

describe("getVotd", () => {
  it("VOTD", async () => {
    const verse = await getVotd("en");
    const verse2 = await getVotd("coffee");

    expect(verse?.citation).toBeDefined();
    expect(verse?.passage).toBeDefined();

    expect(verse2).toBeUndefined();
  });
});
