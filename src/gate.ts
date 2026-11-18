import { brokenRules, recordCatches } from "./rules"
import { APPROVE_HINT, blocking, view, type Broken, type Moment, type Place, type Task } from "./sheet"
import type { World } from "./world"

export const APPROVAL_IS_THE_PERSONS = "Approval belongs to the person, who runs this in their own terminal."

export function momentOf(command: string): "approve" | Moment | null {
  if (/\bproofsheet(\.ts)?\s+(approve\b|rules\s.*--approve\b)/.test(command)) return "approve"
  if (/\bgit\s+push\b|\bgh\s+pr\s+create\b/.test(command)) return "push"
  if (/\bgit\s+commit\b/.test(command)) return "commit"
  return null
}

export function blockers(world: World, here: Place, task: Task | Broken | null, base: string, at: Moment): string[] {
  const todo: string[] = []
  if (task && "problems" in task) todo.push(...task.problems)
  else if (task) {
    if (task.approval !== "approved") todo.push(`The plan is ${task.approval}. ${APPROVE_HINT}`)
    if (at === "push" && task.sheet.units.length === 0) todo.push("The sheet has no units, so nothing is claimed.")
    todo.push(...blocking(view(world, here, task), at))
  }
  const rules = brokenRules(world, here, base)
  recordCatches(world, here.home, rules.caught)
  return [...todo, ...rules.broken]
}
