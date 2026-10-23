import { clearMocks } from "@tauri-apps/api/mocks";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FakeCore, installFakeCore } from "../test/fake-core";
import { useNotesStore } from "./notes";

describe("notes store", () => {
  let core: FakeCore;

  beforeEach(() => {
    setActivePinia(createPinia());
    core = installFakeCore();
  });

  afterEach(() => clearMocks());

  it("creates a note, opens it and lists it", async () => {
    const store = useNotesStore();
    const note = await store.create("rich");
    expect(store.current?.id).toBe(note.id);
    expect(store.summaries.map((summary) => summary.id)).toEqual([note.id]);
  });

  it("saves a patch and refreshes the list", async () => {
    const store = useNotesStore();
    const note = await store.create("rich");
    await store.save(note.id, { title: "Courses" });
    expect(store.current?.title).toBe("Courses");
    expect(store.summaries[0].title).toBe("Courses");
    expect(core.calls.at(-2)).toEqual({
      cmd: "update_note",
      args: { id: note.id, patch: { title: "Courses" } },
    });
  });

  it("moves a note to the trash and back", async () => {
    const store = useNotesStore();
    const note = await store.create("rich");
    await store.trash(note.id);
    expect(store.current).toBeNull();
    expect(store.summaries).toEqual([]);

    await store.setFilter("trash");
    expect(store.summaries.map((summary) => summary.id)).toEqual([note.id]);
    await store.restore(note.id);
    expect(store.summaries).toEqual([]);
    await store.setFilter("all");
    expect(store.summaries.map((summary) => summary.id)).toEqual([note.id]);
  });

  it("empties the trash", async () => {
    const store = useNotesStore();
    const kept = await store.create("rich");
    const thrown = await store.create("code");
    await store.trash(thrown.id);
    await store.setFilter("trash");
    expect(await store.clearTrash()).toBe(1);
    expect(store.summaries).toEqual([]);
    expect(core.notes.map((note) => note.id)).toEqual([kept.id]);
  });

  it("creating a note from the trash view goes back to all notes", async () => {
    const store = useNotesStore();
    await store.setFilter("trash");
    await store.create("rich");
    expect(store.filter).toBe("all");
  });

  it("ignores a search answer that arrives after a newer one", async () => {
    const store = useNotesStore();
    const note = await store.create("rich");
    await store.save(note.id, { content: "lait et pain" });

    const slow = core.hold("search");
    const first = store.search("lait");
    await store.search("pain"); // answered while "lait" is still pending
    slow.release();
    await first;
    expect(store.query).toBe("pain");
    expect(store.results?.[0].excerpt).toContain("pain");
    expect(store.results?.[0].excerpt).not.toContain("\u{E000}lait");
  });

  it("clears the results when the search box is emptied", async () => {
    const store = useNotesStore();
    await store.search("lait");
    expect(store.results).toEqual([]);
    await store.search("  ");
    expect(store.results).toBeNull();
  });

  it("keeps the last opened note when answers come back in the wrong order", async () => {
    const store = useNotesStore();
    const a = await store.create("rich");
    const b = await store.create("rich");
    const slow = core.hold("get_note");
    const openingA = store.open(a.id);
    await store.open(b.id);
    slow.release();
    await openingA;
    expect(store.current?.id).toBe(b.id);
  });

  it("finds the previous and next notes of the list", async () => {
    const store = useNotesStore();
    const first = await store.create("rich");
    const second = await store.create("rich");
    // Newest first: [second, first]
    expect(store.neighbour(second.id, 1)).toBe(first.id);
    expect(store.neighbour(first.id, 1)).toBe(first.id);
    expect(store.neighbour(first.id, -1)).toBe(second.id);
    expect(store.neighbour(null, 1)).toBe(second.id);
  });

  it("lights and puts out the fuse of the open note", async () => {
    const store = useNotesStore();
    const note = await store.create("rich");
    core.fuseDelayHours = 24;
    const lit = await store.setFuse(note.id, true);
    expect(core.calls).toContainEqual({ cmd: "set_ephemeral", args: { id: note.id, enabled: true } });
    expect(lit.ephemeralDelayHours).toBe(24);
    expect(store.current?.destroyAt).toBe(lit.destroyAt);
    expect(store.summaries[0].destroyAt).toBe(lit.destroyAt);
    await store.setFuse(note.id, false);
    expect(store.current?.destroyAt).toBeNull();
  });

  it("creates a note with its fuse already lit", async () => {
    const store = useNotesStore();
    const note = await store.create("rich", true);
    expect(core.calls).toContainEqual({ cmd: "create_note", args: { kind: "rich", fused: true } });
    expect(note.ephemeralMode).toBe("delay");
    expect(store.current?.destroyAt).not.toBeNull();
  });

  it("reloads the open note when Rust says notes changed", async () => {
    const store = useNotesStore();
    const note = await store.create("rich");
    // What the fuse does in Rust: the note goes to the trash on its own.
    Object.assign(core.notes[0], { trashedAt: 5, trashReason: "self_destruct" });
    expect(await store.reload()).toBe(true);
    expect(store.current?.id).toBe(note.id);
    expect(store.current?.trashReason).toBe("self_destruct");
    expect(store.summaries).toEqual([]);
  });

  it("closes the open note when it was deleted for good", async () => {
    const store = useNotesStore();
    await store.create("rich");
    core.notes = [];
    expect(await store.reload()).toBe(false);
    expect(store.current).toBeNull();
  });
});
