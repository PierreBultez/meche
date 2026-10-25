// Actions of the command palette (docs/08).
import {
  ArrowLeftRight,
  CodeXml,
  FileUp,
  ListChecks,
  Maximize2,
  Minimize2,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  Sun,
  Trash2,
  ListFilter as FilterIcon,
} from "lucide-vue-next";
import { type Component, computed, h } from "vue";
import FuseIcon from "../components/fuse/FuseIcon.vue";
import { useImportStore } from "../stores/import";
import { useNotesStore } from "../stores/notes";
import { useSettingsStore } from "../stores/settings";
import { useSyncStore } from "../stores/sync";
import { useUiStore } from "../stores/ui";
import { NOTE_COLORS, NOTE_COLOR_LABELS } from "../theme/note-colors";
import type { ListFilter, NoteColor } from "../types/note";
import type { ThemePreference } from "../types/settings";
import { useCommands } from "./useCommands";

/** The fuse icon of the palette, lit or out (the palette gives icons a `size` only). */
const LitFuseIcon = (props: { size?: number }) => h(FuseIcon, { lit: true, size: props.size });
const FuseOutIcon = (props: { size?: number }) => h(FuseIcon, { lit: false, size: props.size });

export interface PaletteAction {
  id: string;
  label: string;
  /** Extra words that find the action without being shown (« apparence » for the themes). */
  keywords?: string;
  shortcut?: string;
  icon?: Component;
  /** Shown as a swatch instead of an icon. */
  color?: NoteColor;
  run: () => unknown;
}

const FILTER_LABELS: Record<ListFilter, string> = {
  all: "toutes les notes",
  pinned: "notes épinglées",
  ephemeral: "mèches allumées",
  trash: "corbeille",
};

const THEMES: Array<{ value: ThemePreference; label: string; icon: Component }> = [
  { value: "light", label: "clair", icon: Sun },
  { value: "dark", label: "sombre", icon: Moon },
  { value: "system", label: "système", icon: Monitor },
];

export function usePaletteActions() {
  const notes = useNotesStore();
  const settings = useSettingsStore();
  const sync = useSyncStore();
  const ui = useUiStore();
  const imports = useImportStore();
  const commands = useCommands();
  const { actions } = commands;

  return computed<PaletteAction[]>(() => {
    const list: PaletteAction[] = [
      {
        id: "new-note",
        label: "Nouvelle note",
        keywords: "créer écrire",
        shortcut: "Ctrl+N",
        icon: Plus,
        run: () => actions.create("rich"),
      },
      {
        id: "new-code-note",
        label: "Nouvelle note code",
        keywords: "créer snippet",
        shortcut: "Ctrl+Maj+N",
        icon: CodeXml,
        run: () => actions.create("code"),
      },
      {
        id: "new-fused-note",
        label: "Nouvelle note à mèche",
        keywords: "créer éphémère jetable autodestruction",
        icon: LitFuseIcon,
        run: () => actions.create("rich", true),
      },
    ];

    const note = commands.editableNote();
    if (note) {
      list.push(
        {
          id: "toggle-pin",
          label: note.pinned ? "Désépingler la note" : "Épingler la note",
          shortcut: "Ctrl+P",
          icon: note.pinned ? PinOff : Pin,
          run: () => actions.togglePin(note),
        },
        {
          id: "toggle-fuse",
          label: note.ephemeralMode !== null ? "Éteindre la mèche" : "Allumer la mèche",
          keywords: "éphémère autodestruction explosion",
          shortcut: "Ctrl+Maj+E",
          icon: note.ephemeralMode !== null ? FuseOutIcon : LitFuseIcon,
          run: () => actions.toggleFuse(note),
        },
        ...NOTE_COLORS.filter((color) => color !== note.color).map(
          (color): PaletteAction => ({
            id: `color-${color}`,
            label: `Couleur : ${NOTE_COLOR_LABELS[color].toLowerCase()}`,
            color,
            run: () => actions.setColor(note, color),
          }),
        ),
        {
          id: "convert",
          label: note.kind === "rich" ? "Convertir en note code" : "Convertir en note riche",
          icon: ArrowLeftRight,
          run: () => actions.convert(note),
        },
        {
          id: "trash",
          label: "Mettre à la corbeille",
          keywords: "supprimer effacer",
          shortcut: "Ctrl+Suppr",
          icon: Trash2,
          run: () => actions.trash(note.id),
        },
      );
    } else if (notes.current) {
      const id = notes.current.id;
      list.push({
        id: "restore",
        label: "Restaurer la note",
        keywords: "corbeille",
        icon: RotateCcw,
        run: () => actions.restore(id),
      });
    }

    if (sync.loggedIn) {
      list.push({
        id: "sync-now",
        label: "Synchroniser maintenant",
        keywords: "synchro serveur mettre à jour",
        icon: RefreshCw,
        run: () => commands.syncNow(),
      });
    }

    for (const [filter, label] of Object.entries(FILTER_LABELS) as Array<[ListFilter, string]>) {
      if (filter === notes.filter) continue;
      list.push({
        id: `filter-${filter}`,
        label: `Afficher : ${label}`,
        keywords: "filtre liste",
        icon: FilterIcon,
        run: () => commands.showFilter(filter),
      });
    }

    for (const theme of THEMES) {
      if (theme.value === settings.theme) continue;
      list.push({
        id: `theme-${theme.value}`,
        label: `Thème : ${theme.label}`,
        keywords: "apparence couleurs",
        icon: theme.icon,
        run: () => commands.setTheme(theme.value),
      });
    }

    const listShown = !ui.listHidden && !ui.focusMode;
    list.push(
      {
        id: "toggle-list",
        label: listShown ? "Masquer la liste" : "Afficher la liste",
        keywords: "colonne",
        shortcut: "Ctrl+\\",
        icon: listShown ? PanelLeftClose : PanelLeftOpen,
        run: () => commands.toggleList(),
      },
      {
        id: "focus-mode",
        label: ui.focusMode ? "Quitter le mode concentration" : "Mode concentration",
        keywords: "zen plein écran",
        shortcut: "Ctrl+Maj+F",
        icon: ui.focusMode ? Minimize2 : Maximize2,
        run: () => commands.toggleFocusMode(),
      },
      {
        id: "import",
        label: "Importer depuis Standard Notes",
        keywords: "sauvegarde standardnotes migrer",
        icon: FileUp,
        run: () => commands.openImport(),
      },
    );
    if (imports.waiting > 0) {
      list.push({
        id: "triage",
        label: `Reprendre le tri (${imports.waiting} ${imports.waiting > 1 ? "notes" : "note"})`,
        keywords: "import standard notes trier",
        icon: ListChecks,
        run: () => commands.openTriage(),
      });
    }
    list.push(
      {
        id: "settings",
        label: "Réglages",
        keywords: "préférences options",
        icon: Settings,
        run: () => commands.openSettings(),
      },
    );
    return list;
  });
}
