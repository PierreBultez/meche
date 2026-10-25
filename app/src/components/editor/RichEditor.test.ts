// Links of a rich note (docs/05): Ctrl+click opens them in the system browser, a plain click
// never follows them, in a read-only note (trash, triage preview) as in an editable one.
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import RichEditor from "./RichEditor.vue";

enableAutoUnmount(afterEach);

describe("links of a rich note", () => {
  const opened: string[] = [];
  beforeEach(() => {
    opened.length = 0;
    mockIPC((cmd, args) => {
      if (cmd === "plugin:opener|open_url") opened.push((args as { url: string }).url);
    });
  });
  afterEach(() => {
    clearMocks();
    document.body.innerHTML = "";
  });

  async function link(editable: boolean): Promise<HTMLAnchorElement> {
    mount(RichEditor, {
      props: { content: "Voir [le site](https://example.com/) ici.", editable },
      attachTo: document.body,
      global: { plugins: [createPinia()] },
    });
    for (let tries = 0; tries < 100 && !document.querySelector(".rich-editor a"); tries++) {
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return document.querySelector(".rich-editor a") as HTMLAnchorElement;
  }

  const click = (target: Element, init: MouseEventInit = {}) => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };

  it.each([
    ["read-only", false],
    ["editable", true],
  ])("opens it on Ctrl+click only (%s)", async (_case, editable) => {
    const anchor = await link(editable);
    expect(click(anchor).defaultPrevented).toBe(true);
    await flushPromises();
    expect(opened).toEqual([]);
    click(anchor, { ctrlKey: true });
    await flushPromises();
    expect(opened).toEqual(["https://example.com/"]);
  });
});
