import { describe, expect, it } from "vitest";
import { loadLanguage } from "./code-mirror";
import { CODE_LANGUAGES } from "./languages";

describe("code note languages", () => {
  it.each(CODE_LANGUAGES.filter(({ id }) => id !== "plaintext").map(({ id }) => id))(
    "loads %s",
    async (id) => {
      expect(await loadLanguage(id)).not.toBeNull();
    },
  );

  it("loads aliases and gives nothing for plain text or unknown languages", async () => {
    expect(await loadLanguage("ts")).not.toBeNull();
    expect(await loadLanguage("plaintext")).toBeNull();
    expect(await loadLanguage("cobol")).toBeNull();
    expect(await loadLanguage(null)).toBeNull();
  });
});
