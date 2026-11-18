import { markOf, toApprove } from "./approval"
import { baseOf } from "./changes"
import { brokenRules, recordCatches } from "./rules"
import { blocking, currentTask, noUnits, NOT_A_REPOSITORY, place, sheetProblems, view, type Bar, type Broken, type Place, type Task, type View } from "./sheet"
import type { World } from "./world"

type Verdict = { pass: string | null } | { refuse: string } | { blocked: string[] } | { ask: { shown: string; mark: string } }

type Asked = { command?: string | undefined; proven?: boolean | undefined; before?: string[] | undefined; provenBefore?: string[] | undefined; base?: string | undefined }

const APPROVE_HINT = "Run `grisha approve`: the person is shown the plan and asked."
const PLAIN = "[\\p{L}\\p{N}_.\\/@%+=:,-]"
const LEADING_CD = new RegExp(`^\\s*cd\\s+(?:"(${PLAIN}(?:${PLAIN}| )*)"|'(${PLAIN}(?:${PLAIN}| )*)'|((?:~(?=\\/|\\s))?${PLAIN}+))\\s*&&`, "u")

const leadingFolder = (before: string) => LEADING_CD.exec(before)?.slice(1).find(Boolean)

const where = (command: string, pattern: RegExp) => pattern.exec(command)?.index
const whereWords = (command: string, words: string) =>
  where(command, new RegExp(`(?<![\\w-])${words.trim().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")}(?![\\w-])`))
const first = (places: (number | undefined)[]) => places.filter((place) => place !== undefined).sort((a, b) => a - b)[0]

function askedOf(command: string, on: Asked): { what: "plan" | "rules" | Bar; before: string } | null {
  const rules = where(command, /\bgrisha(\.ts)?\s+rules\s.*--approve\b/)
  const plan = where(command, /\bgrisha(\.ts)?\s+approve\b/)
  const proven = first((on.provenBefore ?? []).map((words) => whereWords(command, words)))
  const wrong = first((on.before ?? []).map((words) => whereWords(command, words)))
  const at = rules ?? plan ?? first([proven, wrong])
  if (at === undefined) return null
  return { what: rules !== undefined ? "rules" : plan !== undefined ? "plan" : proven !== undefined ? "all proven" : "nothing wrong", before: command.slice(0, at) }
}

function planBlockers(world: World, here: Place, task: Task | Broken | null, bar: Bar, seen?: View): string[] {
  if (!task) return []
  if ("problems" in task) return [sheetProblems(task).join("\n  ")]
  if (task.sheet.units.length === 0) return [noUnits(task)]
  const unapproved = task.approval === "approved" ? [] : [`${task.approval === "not approved" ? "The plan is not approved" : "The plan changed after it was approved"}. ${APPROVE_HINT}`]
  return [...unapproved, ...blocking(seen ?? view(world, here, task), bar)]
}

function ruleBlockers(world: World, here: Place, base: string): string[] {
  const rules = brokenRules(world, here, base)
  recordCatches(world, here.home, rules.caught)
  return rules.broken
}

export function nextStep(world: World, here: Place, task: Task | Broken | null, base: () => string, seen?: View): string | undefined {
  return planBlockers(world, here, task, "all proven", seen)[0] ?? ruleBlockers(world, here, base())[0]
}

export function judge(world: World, asked: Asked): Verdict {
  const { command } = asked
  const found = command === undefined ? null : askedOf(command, asked)
  if (command !== undefined && !found) return { pass: null }
  const what = found ? found.what : asked.proven ? "all proven" : "nothing wrong"
  const folder = leadingFolder(found?.before ?? "")
  const moved = folder === undefined ? null : world.at(folder)
  const arrived = moved && place(moved)
  const there = moved && arrived ? moved : world
  const here = arrived ?? place(world)
  if (!here) return command === undefined ? { refuse: NOT_A_REPOSITORY } : { pass: null }
  const base = () => baseOf(there, asked.base)
  if (what === "plan" || what === "rules") {
    const wanted = toApprove(there, here, base, what)
    return "nothing" in wanted ? { refuse: wanted.nothing } : { ask: { shown: wanted.shown, mark: markOf(wanted.shown) } }
  }
  const task = currentTask(there, here)
  const todo = [...planBlockers(there, here, task, what), ...ruleBlockers(there, here, base())]
  if (todo.length > 0) return { blocked: todo }
  if (!task) return { pass: "No task is started in this checkout, so only the rules were checked. No rule is broken." }
  return { pass: what === "all proven" ? "Every claim with a check is proven and no rule is broken." : "Nothing is known to be wrong." }
}
