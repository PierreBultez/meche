import { describe, expect, it } from "vitest";
import { codeFence } from "./code-fence";

describe("codeFence", () => {
  it("is 3 backticks, or longer than any run of backticks in the code", () => {
    expect(codeFence("echo 1")).toBe("```");
    expect(codeFence("a `` b")).toBe("```");
    expect(codeFence("```js\nx\n```")).toBe("````");
    expect(codeFence("````")).toBe("`````");
  });
});
