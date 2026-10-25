import { describe, expect, it } from "vitest";
import { router } from ".";

describe("router", () => {
  it("opens the note list by default", async () => {
    await router.push("/");
    expect(router.currentRoute.value.name).toBe("notes");
  });

  it("opens a note by id with hash URLs", () => {
    const route = router.resolve("/notes/0192f1c2");
    expect(route.name).toBe("notes");
    expect(route.params.noteId).toBe("0192f1c2");
    expect(route.href).toBe("#/notes/0192f1c2");
  });

  it("has a settings page", () => {
    expect(router.resolve("/settings").name).toBe("settings");
  });

  it("has a first launch page", () => {
    expect(router.resolve("/welcome").name).toBe("welcome");
  });

  it("has the import and triage pages", () => {
    expect(router.resolve("/import").name).toBe("import");
    expect(router.resolve("/tri").name).toBe("triage");
  });
});
