import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { MATCH_END, MATCH_START } from "../../types/note";
import HighlightedText from "./HighlightedText.vue";

describe("HighlightedText", () => {
  it("wraps matches in <mark>", () => {
    const wrapper = mount(HighlightedText, {
      props: { text: `Lait ${MATCH_START}pain${MATCH_END} et ${MATCH_START}beurre${MATCH_END}` },
    });
    expect(wrapper.findAll("mark").map((mark) => mark.text())).toEqual(["pain", "beurre"]);
    expect(wrapper.text()).toBe("Lait pain et beurre");
  });

  it("never renders note text as HTML", () => {
    const wrapper = mount(HighlightedText, {
      props: { text: `<img src=x onerror=alert(1)> ${MATCH_START}<b>gras</b>${MATCH_END}` },
    });
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find("b").exists()).toBe(false);
    expect(wrapper.text()).toContain("<img src=x onerror=alert(1)>");
    expect(wrapper.find("mark").text()).toBe("<b>gras</b>");
  });
});
