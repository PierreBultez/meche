import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { createPinia } from "pinia";
import NoteCard from "../components/notes/NoteCard.vue";
import { nowSubscribers } from "./useNow";

const HOUR = 3_600_000;

function card(destroyAt: number | null) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
  return mount(NoteCard, {
    props: {
      id: "a",
      title: "Courses",
      preview: "Lait",
      color: "violet",
      kind: "rich",
      pinned: false,
      date: 0,
      destroyAt,
      selected: false,
    },
    global: { plugins: [router, createPinia()] },
  });
}

describe("shared clock of the fuses", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it("is not used by a card without a fuse", () => {
    const wrapper = card(null);
    expect(nowSubscribers()).toBe(0);
    expect(wrapper.text()).not.toContain("min");
    wrapper.unmount();
  });

  it("updates the time left of a fused card once a minute, then stops", async () => {
    const wrapper = card(HOUR + 2 * 60_000);
    expect(nowSubscribers()).toBe(1);
    expect(wrapper.text()).toContain("1 h");
    vi.advanceTimersByTime(3 * 60_000);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("59 min");
    expect(wrapper.find(".text-danger").exists()).toBe(true);
    wrapper.unmount();
    expect(nowSubscribers()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("one clock serves every card", () => {
    const first = card(HOUR * 5);
    const second = card(HOUR * 9);
    expect(nowSubscribers()).toBe(2);
    expect(vi.getTimerCount()).toBe(1);
    first.unmount();
    second.unmount();
  });
});
