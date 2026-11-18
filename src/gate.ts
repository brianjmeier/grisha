import { brokenRules, recordCatches } from "./rules"
import { APPROVE_HINT, blocking, noUnits, sheetProblems, view, type Bar, type Broken, type Place, type Task } from "./sheet"
import type { World } from "./world"

export const foldersOf = (command: string) =>
  [...command.matchAll(/(?:^|&&|\|\||[;|(\n])\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|)]+))/g)].map((found) => found.slice(1).find(Boolean) ?? "")

export const unknownFolder = (folders: string[]) => folders.find((folder) => /[$`]/.test(folder) || folder === "-")

const contains = (command: string, words: string) =>
  new RegExp(`(?<![\\w-])${words.trim().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")}(?![\\w-])`).test(command)

export function askedOf(command: string, on: { before: string[]; provenBefore: string[] }): "approve plan" | "approve rules" | Bar | null {
  if (/\bgrisha(\.ts)?\s+rules\s.*--approve\b/.test(command)) return "approve rules"
  if (/\bgrisha(\.ts)?\s+approve\b/.test(command)) return "approve plan"
  if (on.provenBefore.some((words) => contains(command, words))) return "all proven"
  if (on.before.some((words) => contains(command, words))) return "nothing wrong"
  return null
}

export function blockers(world: World, here: Place, task: Task | Broken | null, base: string, bar: Bar): string[] {
  const todo: string[] = []
  if (task && "problems" in task) todo.push(sheetProblems(task).join("\n  "))
  else if (task && task.sheet.units.length === 0) todo.push(noUnits(task))
  else if (task) {
    if (task.approval !== "approved") todo.push(`${task.approval === "not approved" ? "The plan is not approved" : "The plan changed after it was approved"}. ${APPROVE_HINT}`)
    todo.push(...blocking(view(world, here, task), bar))
  }
  const rules = brokenRules(world, here, base)
  recordCatches(world, here.home, rules.caught)
  return [...todo, ...rules.broken]
}
