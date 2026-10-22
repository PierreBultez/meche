// « / » at the start of a line opens a filterable menu of blocks (docs/05).
import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import { Extension } from "@tiptap/core";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { VueRenderer } from "@tiptap/vue-3";
import SlashMenu from "../components/editor/SlashMenu.vue";
import { type SlashCommand, filterSlashCommands } from "./slash-commands";

type MenuProps = SuggestionProps<SlashCommand, SlashCommand>;

function renderMenu() {
  let renderer: VueRenderer | null = null;

  function place(props: MenuProps): void {
    const rect = props.clientRect?.();
    const element = renderer?.element as HTMLElement | undefined;
    if (!rect || !element) return;
    void computePosition({ getBoundingClientRect: () => rect }, element, {
      placement: "bottom-start",
      strategy: "fixed",
      middleware: [offset(6), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
    });
  }

  return {
    onStart(props: MenuProps) {
      renderer = new VueRenderer(SlashMenu, { props, editor: props.editor });
      const element = renderer.element as HTMLElement | null;
      if (!element) return;
      element.style.position = "fixed";
      element.style.zIndex = "50";
      document.body.append(element);
      place(props);
    },
    onUpdate(props: MenuProps) {
      renderer?.updateProps(props);
      place(props);
    },
    onKeyDown({ event }: { event: KeyboardEvent }): boolean {
      return (renderer?.ref as { onKeyDown?: (event: KeyboardEvent) => boolean } | null)?.onKeyDown?.(event) ?? false;
    },
    onExit() {
      renderer?.element?.remove();
      renderer?.destroy();
      renderer = null;
    },
  };
}

export const SlashCommandExtension = Extension.create({
  name: "slashCommand",
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommand, SlashCommand>({
        editor: this.editor,
        char: "/",
        startOfLine: true,
        items: ({ query }) => filterSlashCommands(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: renderMenu,
      }),
    ];
  },
});
