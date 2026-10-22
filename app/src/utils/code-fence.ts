/**
 * The fence of a fenced code block: at least 3 backticks, and more than the longest run of
 * backticks in the code, so that a ``` line inside the code never closes the block early.
 * Same rule as the code → rich conversion in Rust (db/notes.rs, convert_content).
 */
export function codeFence(code: string): string {
  const longestRun = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longestRun + 1));
}
