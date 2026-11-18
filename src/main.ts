import { join } from "node:path"
import { parseArgs } from "node:util"
import { baseOf, GitProblem } from "./changes"
import { ASKED_ABOUT_SOMETHING_ELSE, confirm, markOf, NO_TASK, NOBODY_WAS_ASKED, toApprove } from "./approval"
import { askThePerson, bashCall, deny } from "./claude-code"
import { askedOf, blockers, folderOf } from "./gate"
import { HELP, helpOn, SHEET_HELP } from "./help"
import { asMermaid, asPullRequest, asText, inBrief } from "./render"
import { approveRules, brokenRules, loadRules, recordCatches, ruleFiles } from "./rules"
import { claimsOf, currentTask, outsidePlan, place, runCheck, runnable, sheetProblems, startTask, view, type Broken, type Place, type Task } from "./sheet"
import type { World } from "./world"

const STARTER_RULES = join(import.meta.dir, "..", "rules", "starter.json")

const OPTIONS = {
  base: { type: "string" },
  for: { type: "string" },
  json: { type: "boolean" },
  mermaid: { type: "boolean" },
  proven: { type: "boolean" },
  before: { type: "string", multiple: true },
  "proven-before": { type: "string", multiple: true },
  init: { type: "boolean" },
  approve: { type: "boolean" },
  help: { type: "boolean" },
} as const

const NOT_A_REPOSITORY = "Not inside a git repository. Run grisha from the checkout you are working in."
const DONE = "Nothing is left: every claim with a check is proven and no rule is broken. `grisha pr` prints the proof for the pull request."
const OUTSIDE = "Say why each one changed in the pull request, or add a box that covers it to the sheet."

function standing(world: World, here: Place, task: Task | Broken | null, base: string): { now: string; done: boolean } {
  const [first] = blockers(world, here, task, base, "all proven")
  return first === undefined ? { now: DONE, done: true } : { now: `Next: ${first}`, done: false }
}

function parse(argv: string[]) {
  try {
    return parseArgs({ args: argv, allowPositionals: true, options: OPTIONS })
  } catch (error) {
    return (error as Error).message
  }
}

export async function main(argv: string[], world: World): Promise<number> {
  try {
    return await answer(argv, world)
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error)
    if (argv[0] === "hook") {
      world.print(deny(`grisha could not check this command, so it is refused.\n${problem}`))
      return 0
    }
    if (!(error instanceof GitProblem)) throw error
    world.print(problem)
    return 1
  }
}

async function answer(argv: string[], world: World): Promise<number> {
  const reply =
    (code: number) =>
    (...rows: string[]) => {
      world.print(rows.join("\n"))
      return code
    }
  const say = reply(0)
  const fail = reply(1)

  const asked = parse(argv)
  if (typeof asked === "string") {
    if (argv[0] === "hook") throw new Error(asked)
    return fail(asked, "", HELP)
  }
  const [command, ...words] = asked.positionals
  const flags = asked.values
  if (!command || command === "help" || flags.help) return say(helpOn(command === "help" ? words[0] : undefined))
  const base = () => baseOf(world, flags.base)

  if (command === "hook" || command === "gate") {
    const call = command === "hook" ? bashCall(world.input()) : null
    if (command === "hook" && !call) return 0
    const about = call ? call.command : flags.for
    const when = about === undefined ? (flags.proven ? "all proven" : "nothing wrong") : askedOf(about, { before: flags.before ?? [], provenBefore: flags["proven-before"] ?? [] })
    if (when === null) return 0
    const folder = about === undefined ? undefined : folderOf(about)
    const there = folder ? world.at(folder) : world
    const here = place(there)
    if (!here) return about === undefined ? fail(NOT_A_REPOSITORY) : 0
    if (when === "approve plan" || when === "approve rules") {
      const asked = toApprove(there, here, () => baseOf(there, flags.base), when === "approve plan" ? "plan" : "rules")
      if ("nothing" in asked) return call ? say(deny(asked.nothing)) : fail(asked.nothing)
      const mark = markOf(asked.shown)
      if (call) return say(askThePerson(asked.shown, call, `export GRISHA_APPROVED=${mark}; ${call.command}`))
      world.print([asked.shown, "", "Ask the person. On their yes, run the command with this set:", `GRISHA_APPROVED=${mark}`].join("\n"))
      return 2
    }
    const task = currentTask(there, here)
    const todo = blockers(there, here, task, baseOf(there, flags.base), when)
    if (call) return todo.length > 0 ? say(deny(todo.join("\n"))) : 0
    if (todo.length > 0) return fail("Before this goes further:", ...todo.map((line) => `- ${line}`))
    if (!task) return say("No task is started in this checkout, so only the rules were checked. No rule is broken.")
    return say(when === "all proven" ? "Every claim with a check is proven and no rule is broken." : "Nothing is known to be wrong.")
  }

  const here = place(world)
  if (!here) return fail(NOT_A_REPOSITORY)

  if (command === "start") {
    const title = words.join(" ").trim()
    if (!title) return fail('Say what the task is: grisha start "Unread badge counts only this user\'s rows"')
    const started = startTask(world, here, title)
    if (started.existed) return say(`Picked up the sheet: ${started.path}`, "Run `grisha next`.")
    return say(`New sheet: ${started.path}`, "Write the plan into it, then run `grisha next`.", "", SHEET_HELP)
  }
  if (command === "home") return say(here.home)
  const approving = command === "approve" ? "plan" : command === "rules" && flags.approve ? "rules" : null
  if (approving) {
    const asked = toApprove(world, here, base, approving)
    if ("nothing" in asked) return (asked.fine ? say : fail)(asked.nothing)
    const answered = await confirm(world, asked.shown)
    if (answered === "unavailable") return fail(NOBODY_WAS_ASKED)
    if (answered === "something else") return fail(ASKED_ABOUT_SOMETHING_ELSE)
    if (answered === "no") return fail("Not approved. Ask the person what they want changed, change it, then run this command again.")
    asked.approve()
    return approving === "plan" ? say("The person approved the plan.", standing(world, here, currentTask(world, here), base()).now) : say("The person approved the rule changes.")
  }
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
    if (files.every((file) => file.text === null && !file.approved)) return say(`No rules yet. \`grisha rules --init\` writes a starter set to ${yours?.path}.`, ...read)
    const groups = [...loadRules(files).groups].map(([name, patterns]) => `  ${name}  ${patterns.join("  ")}`)
    const where = groups.length > 0 ? [...read, "", "File groups a rule can apply to. A later file replaces a group by name:", ...groups] : read
    const { broken, caught } = brokenRules(world, here, base(), files)
    recordCatches(world, here.home, caught)
    return broken.length > 0 ? fail(...broken, ...where) : say("No rule is broken by the lines this branch adds.", ...where)
  }

  const task = currentTask(world, here)
  if (command === "next") {
    const { now, done } = standing(world, here, task, base())
    const brief = task && !("problems" in task) ? [...inBrief(view(world, here, task)), ""] : []
    if (!done) return fail(...brief, now, "", "Then run `grisha next` again.")
    if (!task) return fail(NO_TASK)
    if ("problems" in task) return fail(...sheetProblems(task))
    const toRead = claimsOf(view(world, here, task).units).filter((claim) => claim.status === "for you to read")
    const outside = outsidePlan(world, task, base())
    return say(
      ...brief,
      now,
      ...toRead.map((claim) => `Left for the person to read: ${claim.id}, ${claim.says}.`),
      ...(outside.length > 0 ? [`${outside.length} changed ${outside.length === 1 ? "file is" : "files are"} in no planned box: \`grisha outside\` lists ${outside.length === 1 ? "it" : "them"}. ${OUTSIDE}`] : []),
    )
  }
  if (!task) return fail(NO_TASK)
  if ("problems" in task) return fail(...sheetProblems(task))
  const seen = () => view(world, here, task)

  if (command === "show") {
    if (flags.json) return say(JSON.stringify(seen(), null, 2))
    if (flags.mermaid) return say(asMermaid(seen()))
    return say(asText(seen()), "", standing(world, here, task, base()).now)
  }
  if (command === "run") {
    if (task.approval !== "approved") return fail(`Nothing is run before the plan is approved. ${standing(world, here, task, base()).now}`)
    const all = runnable(task.sheet)
    const unknown = words.filter((id) => !all.some((one) => one.claim.id === id))
    if (unknown.length > 0) return fail(`No runnable claim called ${unknown.join(", ")}. Runnable: ${all.map((one) => one.claim.id).join(", ") || "none"}.`)
    const ran = all.filter((one) => words.length === 0 || words.includes(one.claim.id)).map((one) => runCheck(world, here, task, one))
    const rows = ran.map((one) => `${one.claim}: ${one.exit === 0 ? "passed" : `failed (exit ${one.exit})`}    ${one.evidence}`)
    const after = { ...task, runs: [...task.runs, ...ran] }
    return say(...rows, "", ...inBrief(view(world, here, after)), "", standing(world, here, after, base()).now)
  }
  if (command === "outside") {
    const outside = outsidePlan(world, task, base())
    return say(outside.length === 0 ? "Every changed file is inside a planned box." : `Changed, but in no planned box:\n${outside.map((file) => `  ${file}`).join("\n")}\n${OUTSIDE}`)
  }
  if (command === "pr") return say(asPullRequest(seen(), outsidePlan(world, task, base())))
  return fail(`Unknown command "${command}".`, "", HELP)
}
