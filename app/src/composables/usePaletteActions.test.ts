import { clearMocks } from "@tauri-apps/api/mocks";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineComponent, type Ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { useNotesStore } from "../stores/notes";
import { useToastsStore } from "../stores/toasts";
import { type FakeCore, installFakeCore } from "../test/fake-core";
import { type PaletteAction, usePaletteActions } from "./usePaletteActions";

/** The palette actions, read inside a component (they need the router and the stores). */
async function paletteActions(): Promise<Ref<PaletteAction[]>> {
  let actions!: Ref<PaletteAction[]>;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:path(.*)*", name: "notes", component: { template: "<div />" } }],
  });
  mount(
    defineComponent({
      setup() {
        actions = usePaletteActions();
        return () => null;
      },
    }),
    { global: { plugins: [router] } },
  );
  await router.isReady();
  return actions;
}

const labels = (actions: PaletteAction[]) => actions.map((action) => action.label);

describe("palette actions of the fuse (docs/08)", () => {
  let core: FakeCore;

  beforeEach(() => {
    setActivePinia(createPinia());
    core = installFakeCore();
  });
  afterEach(() => clearMocks());

  it("always offers a new fused note", async () => {
    const actions = await paletteActions();
    const create = actions.value.find((action) => action.label === "Nouvelle note à mèche");
    await create?.run();
    expect(core.calls).toContainEqual({ cmd: "create_note", args: { kind: "rich", fused: true } });
    expect(core.notes[0].ephemeralMode).toBe("delay");
  });

  it("lights then puts out the fuse of the open note", async () => {
    const notes = useNotesStore();
    await notes.create("rich");
    const actions = await paletteActions();
    expect(labels(actions.value)).toContain("Allumer la mèche");

    await actions.value.find((action) => action.id === "toggle-fuse")?.run();
    expect(notes.current?.ephemeralMode).toBe("delay");
    expect(labels(actions.value)).toContain("Éteindre la mèche");

    await actions.value.find((action) => action.id === "toggle-fuse")?.run();
    expect(notes.current?.ephemeralMode).toBeNull();
  });

  it("explodes a note whose fuse burnt out instead of putting it out", async () => {
    const notes = useNotesStore();
    const note = await notes.create("rich", true);
    // The fuse burnt out a moment ago; the minute's maintenance has not run yet.
    core.notes[0].destroyAt = note.createdAt;
    const actions = await paletteActions();

    await actions.value.find((action) => action.id === "toggle-fuse")?.run();

    expect(notes.current?.trashedAt).toBe(note.createdAt);
    expect(notes.current?.trashReason).toBe("self_destruct");
    expect(useToastsStore().toasts.map((toast) => toast.message)).toEqual([
      "Sa mèche a brûlé : cette note est dans la corbeille.",
    ]);
  });

  it("offers no fuse action for a note in the trash", async () => {
    const notes = useNotesStore();
    const note = await notes.create("rich");
    await notes.trash(note.id);
    await notes.open(note.id);
    const actions = await paletteActions();
    expect(actions.value.some((action) => action.id === "toggle-fuse")).toBe(false);
  });
});
