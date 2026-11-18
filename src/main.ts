import { join } from "node:path"
import { parseArgs } from "node:util"
import { baseOf } from "./changes"
import { bashCommand, deny } from "./claude-code"
import { asMermaid, asPullRequest, asText } from "./render"
import { approveRules, brokenRules, loadRules, ruleFiles, RULES_APPROVE_HINT, unapprovedRules } from "./rules"
import { approve, blocking, currentTask, outsidePlan, place, runCheck, runnable, startTask, view, type Broken, type Moment, type Place, type Task } from "./sheet"
import type { World } from "./world"

const STARTER_RULES = join(import.meta.dir, "..", "rules", "starter.json")

const USAGE = `proofsheet: one sheet per task that says what must be true and how each claim is proven.

  start "<task>"      begin a sheet for a task in this checkout, or pick it up again
  show                the plan and where each claim stands (--json, --mermaid)
  approve             the person approves the plan; nothing is run before this
  run [claim ...]     run the checks and record what happened
  outside             changed files that no planned box covers
  rules               check the lines this branch adds against your rules and this repository's (--init, --approve)
  gate                what blocks a commit (--final: a push or pull request; --for "<command>": that command)
  hook                gate --for as a Claude Code PreToolUse hook: reads the hook's JSON, answers in its shape
  pr                  the proof as a pull request section
  home                where this repository's sheets and verification skills live

  --base <ref>        compare against this ref instead of the default branch`

const OPTIONS = {
  base: { type: "string" },
  for: { type: "string" },
  json: { type: "boolean" },
  mermaid: { type: "boolean" },
  final: { type: "boolean" },
  init: { type: "boolean" },
  approve: { type: "boolean" },
  help: { type: "boolean" },
} as const

const APPROVE_HINT = "The person approves it by running `proofsheet approve` in their own terminal."
const NOT_A_REPOSITORY = "Not inside a git repository. Run proofsheet from the checkout you are working in."

function parse(argv: string[]) {
  try {
    return parseArgs({ args: argv, allowPositionals: true, options: OPTIONS })
  } catch (error) {
    return (error as Error).message
  }
}

function momentOf(command: string): "approve" | Moment | null {
  if (/\bproofsheet(\.ts)?\s+(approve\b|rules\s.*--approve\b)/.test(command)) return "approve"
  if (/\bgit\s+push\b|\bgh\s+pr\s+create\b/.test(command)) return "push"
  if (/\bgit\s+commit\b/.test(command)) return "commit"
  return null
}

function blockers(world: World, here: Place, task: Task | Broken | null, base: () => string, at: Moment): string[] {
  const todo: string[] = []
  if (task && "problems" in task) todo.push(...task.problems)
  else if (task) {
    if (task.approval !== "approved") todo.push(`The plan is ${task.approval}. ${APPROVE_HINT}`)
    if (at === "push" && task.sheet.units.length === 0) todo.push("The sheet has no units, so nothing is claimed.")
    todo.push(...blocking(view(world, here, task), at))
  }
  return [...todo, ...brokenRules(world, here, base())]
}

export async function main(argv: string[], world: World): Promise<number> {
  const answer =
    (code: number) =>
    (...rows: string[]) => {
      world.print(rows.join("\n"))
      return code
    }
  const say = answer(0)
  const fail = answer(1)

  const asked = parse(argv)
  if (typeof asked === "string") return fail(asked, "", USAGE)
  const [command, ...words] = asked.positionals
  const flags = asked.values
  if (!command || command === "help" || flags.help) return say(USAGE)
  const base = () => baseOf(world, flags.base)

  if (command === "hook" || command === "gate") {
    const about = command === "hook" ? bashCommand(world.input()) : flags.for
    const when = about === undefined ? (flags.final ? "push" : "commit") : momentOf(about)
    if (when === null) return 0
    const here = place(world)
    if (!here) return about === undefined ? fail(NOT_A_REPOSITORY) : 0
    const task = currentTask(world, here)
    const todo = when === "approve" ? ["Approval belongs to the person, who runs this in their own terminal."] : blockers(world, here, task, base, when)
    if (command === "hook") return todo.length > 0 ? say(deny(todo.join("\n"))) : 0
    if (todo.length > 0) return fail("Before this goes further:", ...todo.map((line) => `- ${line}`))
    return say(task ? "Nothing blocks." : "No task is started in this checkout, so only the rules were checked. Nothing blocks.")
  }

  const here = place(world)
  if (!here) return fail(NOT_A_REPOSITORY)

  if (command === "start") {
    const title = words.join(" ").trim()
    if (!title) return fail('Say what the task is: proofsheet start "Unread badge counts only this user\'s rows"')
    const started = startTask(world, here, title)
    return say(`${started.existed ? "Picked up the sheet" : "New sheet"}: ${started.path}`, "Write the boxes and units into it, then run `proofsheet show`.")
  }
  if (command === "home") return say(here.home)
  if (command === "rules") {
    const files = ruleFiles(world, here, base())
    const [yours] = files
    if (flags.init) {
      if (!yours || yours.text !== null) return fail(`Rules already exist at ${yours?.path}. Edit that file.`)
      if (yours.approved) return fail(`Your rules file is gone, but the copy you approved is at ${yours.approvedAt}. Copy it back to ${yours.path}.`)
      const starter = world.read(STARTER_RULES) ?? "{}\n"
      world.write(yours.path, starter)
      approveRules(world, [{ ...yours, text: starter }])
      return say(`Starter rules written to ${yours.path}. They apply in every repository.`)
    }
    const width = Math.max(...files.map((file) => file.covers.length))
    const read = [
      "",
      "Rules are read from these files. A later file adds rules, replaces one by name, or turns one off:",
      ...files.map((file) => `  ${file.covers.padEnd(width)}  ${file.path}${file.text === null ? "  (no file)" : ""}${file.waits ? "  (your copy differs from the base branch and waits to be merged)" : ""}`),
    ]
    if (flags.approve) {
      const unapproved = unapprovedRules(files)
      if (unapproved.length === 0) return say("The rules here are the ones already approved.")
      const answered = await world.confirm(["Rules that differ from the ones you approved:", ...unapproved.map((row) => `  ${row}`)].join("\n"))
      if (answered === "unavailable") return fail(RULES_APPROVE_HINT)
      if (answered === "no") return fail("Not approved.")
      approveRules(world, files)
      return say("Approved.")
    }
    if (files.every((file) => file.text === null && !file.approved)) return say(`No rules yet. \`proofsheet rules --init\` writes a starter set to ${yours?.path}.`, ...read)
    const groups = [...loadRules(files).groups].map(([name, patterns]) => `  ${name}  ${patterns.join("  ")}`)
    const where = groups.length > 0 ? [...read, "", "File groups a rule can apply to. A later file replaces a group by name:", ...groups] : read
    const broken = brokenRules(world, here, base(), files)
    return broken.length > 0 ? fail(...broken, ...where) : say("No rule is broken by the lines this branch adds.", ...where)
  }

  const task = currentTask(world, here)
  if (!task) return fail('No task is started in this checkout. Begin with: proofsheet start "<task>"')
  if ("problems" in task) return fail(`Fix the sheet at ${task.path}:`, ...task.problems.map((problem) => `- ${problem}`))
  const seen = () => view(world, here, task)

  if (command === "show") {
    if (flags.json) return say(JSON.stringify(seen(), null, 2))
    if (flags.mermaid) return say(asMermaid(seen()))
    return say(asText(seen()), ...(task.approval === "approved" ? [] : ["", APPROVE_HINT]))
  }
  if (command === "approve") {
    if (task.sheet.units.length === 0) return fail("Nothing to approve: the sheet has no units yet.")
    const answered = await world.confirm(asText(seen()))
    if (answered === "unavailable") return fail(APPROVE_HINT)
    if (answered === "no") return fail("Not approved.")
    approve(world, task)
    return say("Approved. Build one unit at a time: run its checks, see them fail, make the change, run them again.")
  }
  if (command === "run") {
    if (task.approval !== "approved") return fail(`The plan is ${task.approval}, so nothing is run. ${APPROVE_HINT}`)
    const all = runnable(task.sheet)
    const unknown = words.filter((id) => !all.some((one) => one.claim.id === id))
    if (unknown.length > 0) return fail(`No runnable claim called ${unknown.join(", ")}. Runnable: ${all.map((one) => one.claim.id).join(", ") || "none"}.`)
    const rows = all
      .filter((one) => words.length === 0 || words.includes(one.claim.id))
      .map((one) => {
        const ran = runCheck(world, here, task, one)
        return `${one.claim.id}: ${ran.exit === 0 ? "passed" : `failed (exit ${ran.exit})`}    ${ran.evidence}`
      })
    return say(...rows, "", asText(seen()))
  }
  if (command === "outside") {
    const outside = outsidePlan(world, task, base())
    return say(outside.length === 0 ? "Every changed file is inside a planned box." : `Changed, but in no planned box:\n${outside.map((file) => `  ${file}`).join("\n")}`)
  }
  if (command === "pr") return say(asPullRequest(seen(), outsidePlan(world, task, base())))
  return fail(`Unknown command "${command}".`, "", USAGE)
}
