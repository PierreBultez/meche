// Checklist notes of Standard Notes (`task`), from two editors (docs/07, section 2):
// « Advanced Checklist » stores JSON, « Simple Task Editor » one task per line.
import type { JSONContent } from "@tiptap/core";
import { doc, heading, linesToInline, paragraph, taskItem, text } from "./doc";

interface AdvancedTask {
  description?: unknown;
  completed?: unknown;
}
interface AdvancedGroup {
  name?: unknown;
  draft?: unknown;
  tasks?: unknown;
}

/** Whether `text` is the JSON of « Advanced Checklist » (`{ groups: […] }`). */
export function isAdvancedChecklist(source: string): boolean {
  try {
    const parsed = JSON.parse(source) as { groups?: unknown };
    return Boolean(parsed) && Array.isArray(parsed.groups);
  } catch {
    return false;
  }
}

const lines = (value: unknown) =>
  (typeof value === "string" ? value : "").replace(/\r\n?/g, "\n").split("\n");

/**
 * « Advanced Checklist »: each group becomes a level 2 heading, followed by its tasks to do,
 * then its tasks done (the order the extension shows them in). A task typed but not added yet
 * (`draft`) becomes a box to do. Call `isAdvancedChecklist` first.
 */
export function advancedChecklistToDoc(source: string): { doc: JSONContent; sourceText: string } {
  const { groups } = JSON.parse(source) as { groups: AdvancedGroup[] };
  const blocks: JSONContent[] = [];
  const texts: string[] = [];
  for (const group of groups) {
    const name = typeof group?.name === "string" ? group.name.trim() : "";
    if (name) {
      blocks.push(heading(2, [text(name)]));
      texts.push(name);
    }
    const tasks = (Array.isArray(group?.tasks) ? (group.tasks as AdvancedTask[]) : []).filter(
      (task) => task && typeof task.description === "string" && task.description.trim(),
    );
    const item = (task: AdvancedTask, checked: boolean) => {
      texts.push(String(task.description));
      return taskItem(checked, [paragraph(linesToInline(lines(task.description)))]);
    };
    const todo = tasks.filter((task) => task.completed !== true).map((task) => item(task, false));
    if (typeof group?.draft === "string" && group.draft.trim()) {
      todo.push(item({ description: group.draft }, false));
    }
    const done = tasks.filter((task) => task.completed === true).map((task) => item(task, true));
    if (todo.length || done.length) blocks.push({ type: "taskList", content: [...todo, ...done] });
  }
  return { doc: doc(blocks), sourceText: texts.join("\n") };
}

// "- [ ] task", "- [x] task", also "* [ ]" and "[X]".
const TASK_LINE = /^\s*(?:[-*+]\s*)?\[([ xX])\]\s?(.*)$/;

/** « Simple Task Editor »: one `- [ ] …` / `- [x] …` line per task. Other lines are kept as
 * paragraphs, and blank lines separate them. */
export function simpleTasksToDoc(source: string): JSONContent {
  const blocks: JSONContent[] = [];
  let tasks: JSONContent[] = [];
  let paragraphLines: string[] = [];
  const flush = () => {
    if (tasks.length) blocks.push({ type: "taskList", content: tasks });
    if (paragraphLines.length) blocks.push(paragraph(linesToInline(paragraphLines)));
    tasks = [];
    paragraphLines = [];
  };
  for (const line of lines(source)) {
    const task = TASK_LINE.exec(line);
    if (task) {
      if (paragraphLines.length) flush();
      tasks.push(taskItem(task[1] !== " ", [paragraph([text(task[2])])]));
    } else if (line.trim()) {
      if (tasks.length) flush();
      paragraphLines.push(line);
    } else {
      flush();
    }
  }
  flush();
  return doc(blocks);
}
