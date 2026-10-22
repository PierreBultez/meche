import { describe, expect, it } from "vitest";
import { noteAsMarkdown } from "./note-markdown";

describe("noteAsMarkdown", () => {
  it("keeps rich notes as they are", () => {
    expect(noteAsMarkdown("rich", "# Titre\n\n- [ ] Lait", null)).toBe("# Titre\n\n- [ ] Lait");
  });

  it("wraps code notes in a fenced block", () => {
    expect(noteAsMarkdown("code", "echo 1\n", "bash")).toBe("```bash\necho 1\n```");
    expect(noteAsMarkdown("code", "texte", "plaintext")).toBe("```\ntexte\n```");
  });

  it("uses a longer fence when the code contains backticks", () => {
    expect(noteAsMarkdown("code", "a ``` b", "markdown")).toBe("````markdown\na ``` b\n````");
  });
});
