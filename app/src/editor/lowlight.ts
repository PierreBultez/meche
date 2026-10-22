// Syntax highlighting of code blocks in rich notes. Only the V1 languages are bundled,
// to keep the editor light (docs/08, performance budgets).
import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { CODE_LANGUAGES } from "./languages";

export const lowlight = createLowlight({
  bash,
  css,
  javascript,
  json,
  markdown,
  php,
  plaintext,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
});

// Our ids and aliases → highlight.js grammars ("vue" and "html" use the XML/HTML grammar).
const GRAMMAR_OF: Record<string, string> = { vue: "xml" };
for (const { id, aliases } of CODE_LANGUAGES) {
  const grammar = GRAMMAR_OF[id] ?? id;
  const names = [id, ...aliases].filter((name) => name !== grammar);
  if (names.length > 0) {
    lowlight.registerAlias({ [grammar]: names });
  }
}
