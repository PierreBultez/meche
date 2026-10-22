import { describe, expect, it } from "vitest";
import { router } from ".";

describe("router", () => {
  it("resolves the home route", () => {
    expect(router.resolve("/").name).toBe("home");
  });

  it("uses hash URLs", () => {
    expect(router.resolve("/").href).toBe("#/");
  });
});
