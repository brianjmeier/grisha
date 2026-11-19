import { join } from "node:path"
import { parseArgs } from "node:util"
import { refusal, toApprove } from "./approval"
import { baseOf, GitProblem } from "./changes"
import { askThePerson, bashCall, deny } from "./claude-code"
import { judge, nextStep } from "./gate"
import { helpOn } from "./help"
import { asMermaid, asPullRequest, asText, inBrief } from "./render"
import { approveRules, brokenRules, everyMatch, loadRules, recordCatches, ruleFiles } from "./rules"
import { currentTask, leftToRead, NOT_A_REPOSITORY, outsidePlan, place, runCheck, runnable, startTask, usable, view, whyUnusable, type Broken, type Task, type View } from "./sheet"
import { counted } from "./text"
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

const DONE = "Nothing is left: every claim with a check is proven and no rule is broken. `grisha pr` prints the proof for the pull request."
const AGAIN = "Then run `grisha next` again."
const OUTSIDE = "Say why each one changed in the pull request, or add a box that covers it to the sheet."

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
    return fail(asked, "", helpOn())
  }
  const [command, ...words] = asked.positionals
  const flags = asked.values
  if (!command || command === "help" || flags.help) return say(helpOn(command === "help" ? words[0] : undefined))
  let merged: string | undefined
  const base = () => (merged ??= baseOf(world, flags.base))

  if (command === "hook" || command === "gate") {
    const call = command === "hook" ? bashCall(world.input()) : null
    if (command === "hook" && !call) return 0
    const verdict = judge(world, { command: call ? call.command : flags.for, proven: flags.proven, before: flags.before, provenBefore: flags["proven-before"], base: flags.base })
    if ("pass" in verdict) return call || verdict.pass === null ? 0 : say(verdict.pass)
    if ("ask" in verdict) {
      const { shown, mark } = verdict.ask
      if (call) return say(askThePerson(shown, call, `export GRISHA_APPROVED=${mark}; ${call.command}`))
      return reply(2)(shown, "", "Ask the person. On their yes, run the command with this set:", `GRISHA_APPROVED=${mark}`)
    }
    if (call) return say(deny("refuse" in verdict ? verdict.refuse : verdict.blocked.join("\n")))
    return "refuse" in verdict ? fail(verdict.refuse) : fail("Before this goes further:", ...verdict.blocked.map((line) => `- ${line}`))
  }

  const here = place(world)
  if (!here) return fail(NOT_A_REPOSITORY)
  const left = (task: Task | Broken | null, seen?: View) => {
    const step = nextStep(world, here, task, base, seen)
    return step === undefined ? DONE : `Next: ${step}`
  }

  if (command === "start") {
    const title = words.join(" ").trim()
    if (!title) return fail('Say what the task is: grisha start "Unread badge counts only this user\'s rows"')
    const started = startTask(world, here, title)
    if (started.existed) return say(`Picked up the sheet: ${started.path}`, "Run `grisha next`.")
    return say(`New sheet: ${started.path}`, "Write the plan into it, then run `grisha next`.", "", helpOn("sheet"))
  }
  if (command === "home") return say(here.home)
  const approving = command === "approve" ? "plan" : command === "rules" && flags.approve ? "rules" : null
  if (approving) {
    const wanted = toApprove(world, here, base, approving)
    if ("nothing" in wanted) return (wanted.fine ? say : fail)(wanted.nothing)
    const refused = await refusal(world, wanted.shown)
    if (refused) return fail(refused)
    wanted.approve()
    return approving === "plan" ? say("The person approved the plan.", left(currentTask(world, here))) : say("The person approved the rule changes.")
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
    const loaded = loadRules(files)
    const unknown = loaded.problems.length > 0 ? [] : words.filter((name) => !loaded.rules.some((rule) => rule.name === name))
    if (unknown.length > 0) return fail(`No rule called ${unknown.join(", ")}. The rules: ${loaded.rules.map((rule) => rule.name).join(", ")}.`)
    const groups = [...loaded.groups].map(([name, patterns]) => `  ${name}  ${patterns.join("  ")}`)
    const where = groups.length > 0 ? [...read, "", "File groups a rule can apply to. A later file replaces a group by name:", ...groups] : read
    const { broken, caught, notBlocked, table } = everyMatch(world, here, base(), files, words)
    recordCatches(world, here.home, caught)
    return (broken.length > 0 ? fail : say)(
      ...(broken.length > 0 ? broken : ["No rule is broken."]),
      ...(notBlocked.length > 0 ? ["", "These lines match a rule that does not block them:", ...notBlocked] : []),
      ...(table.length > 0 ? ["", "Each rule, the lines it blocks, and the lines already in the code that match it:", ...table] : []),
      ...(table.length > 0 && words.length === 0 ? ["`grisha rules <rule>` lists every line a rule matches."] : []),
      ...where,
    )
  }

  const task = currentTask(world, here)
  if (!usable(task)) {
    const now = command === "next" ? left(task) : DONE
    return fail(...(now === DONE ? whyUnusable(task) : [now, "", AGAIN]))
  }
  if (command === "next") {
    const seen = view(world, here, task)
    const now = left(task, seen)
    if (now !== DONE) return fail(...inBrief(seen), "", now, "", AGAIN)
    const outside = outsidePlan(world, task, base())
    const { notBlocked } = brokenRules(world, here, base())
    return say(
      ...inBrief(seen),
      "",
      now,
      ...leftToRead(seen).map((claim) => `Left for the person to read: ${claim.id}, ${claim.says}.`),
      ...(notBlocked > 0 ? [`${counted(notBlocked, "added line")} ${notBlocked === 1 ? "matches" : "match"} a rule that blocks nothing: \`grisha rules\` lists ${notBlocked === 1 ? "it" : "them"}.`] : []),
      ...(outside.length > 0 ? [`${outside.length} changed ${outside.length === 1 ? "file is" : "files are"} in no planned box: \`grisha outside\` lists ${outside.length === 1 ? "it" : "them"}. ${OUTSIDE}`] : []),
    )
  }

  if (command === "show") {
    const seen = view(world, here, task)
    if (flags.json) return say(JSON.stringify(seen, null, 2))
    if (flags.mermaid) return say(asMermaid(seen))
    return say(asText(seen), "", left(task, seen))
  }
  if (command === "run") {
    if (task.approval !== "approved") return fail(`Nothing is run before the plan is approved. ${left(task)}`)
    const all = runnable(task.sheet)
    const unknown = words.filter((id) => !all.some((one) => one.claim.id === id))
    if (unknown.length > 0) return fail(`No runnable claim called ${unknown.join(", ")}. Runnable: ${all.map((one) => one.claim.id).join(", ") || "none"}.`)
    const ran = all.filter((one) => words.length === 0 || words.includes(one.claim.id)).map((one) => runCheck(world, here, task, one))
    const rows = ran.map((one) => `${one.claim}: ${one.exit === 0 ? "passed" : `failed (exit ${one.exit})`}    ${one.evidence}`)
    const after = { ...task, runs: [...task.runs, ...ran] }
    const seen = view(world, here, after)
    return say(...rows, "", ...inBrief(seen), "", left(after, seen))
  }
  if (command === "outside") {
    const outside = outsidePlan(world, task, base())
    return say(outside.length === 0 ? "Every changed file is inside a planned box." : `Changed, but in no planned box:\n${outside.map((file) => `  ${file}`).join("\n")}\n${OUTSIDE}`)
  }
  if (command === "pr") return say(asPullRequest(view(world, here, task), outsidePlan(world, task, base())))
  return fail(`Unknown command "${command}".`, "", helpOn())
}
