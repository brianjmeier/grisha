import { createHash } from "node:crypto"
import { join } from "node:path"
import { changedFiles, checkout, everyFile, matches } from "./changes"
import { isText, labelled, lines } from "./text"
import type { World } from "./world"

const HOWS = ["script", "test", "drive app", "model", "person reads"] as const
const KINDS = ["pin", "reshape", "change"] as const
const ROLES = ["proves", "keeps"] as const

export type Check = { how: (typeof HOWS)[number]; run?: string }
type Claim = { id: string; says: string; role: (typeof ROLES)[number]; check: Check | null; about?: string[] }
type Unit = { name: string; kind: (typeof KINDS)[number]; touches: string[]; claims: Claim[] }
type Box = { name: string; paths: string[]; calls?: string[] }
type Sheet = { task: string; boxes: Box[]; units: Unit[] }
type Run = { claim: string; run: string; at: string; exit: number; fingerprint: string; evidence: string }
type Runnable = { unit: Unit; claim: Claim; run: string }

export type Status = "no check" | "for you to read" | "not run" | "failing" | "stale" | "passes, never seen failing" | "proven"
export type Approval = "not approved" | "changed since it was approved" | "approved"
export type Moment = "commit" | "push"
export type Place = { root: string; home: string; pointer: string }
export type Task = { dir: string; sheet: Sheet; runs: Run[]; approval: Approval }
export type Broken = { path: string; problems: string[] }
export type View = {
  task: string
  approval: Approval
  boxes: Box[]
  units: (Omit<Unit, "claims"> & { claims: (Claim & { status: Status })[] })[]
}

const rerun = (id: string) => `Run \`grisha run ${id}\`.`

const BLOCKS: Record<Status, { at: Moment; fix: (id: string) => string } | null> = {
  "no check": { at: "push", fix: (id) => `${id} has no check. Give it one, or set its check to { "how": "person reads" }.` },
  "for you to read": null,
  "not run": { at: "push", fix: (id) => `${id} is not run. ${rerun(id)}` },
  failing: { at: "commit", fix: (id) => `${id} is failing. ${rerun(id)}` },
  stale: { at: "commit", fix: (id) => `${id} is stale. ${rerun(id)}` },
  "passes, never seen failing": {
    at: "push",
    fix: (id) => `${id} passes but was never seen failing. Break the code it covers, run \`grisha run ${id}\`, restore the code and run it again.`,
  },
  proven: null,
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex")
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const oneOf = (options: readonly string[]) => options.map((option) => `"${option}"`).join(", ")
const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
const taskDir = (here: Place, name: string) => join(here.home, "tasks", name)
const planHash = (sheet: Sheet) => sha(JSON.stringify(sheet))
const pathsOf = (sheet: Sheet, boxes: string[]) => sheet.boxes.filter((box) => boxes.includes(box.name)).flatMap((box) => box.paths)

export const APPROVE_HINT = "The person approves it by running `grisha approve` in their own terminal."

export function place(world: World): Place | null {
  const found = checkout(world)
  return found && { root: found.root, home: join(world.home, "repos", found.name.replace(/[^A-Za-z0-9._-]/g, "-")), pointer: join(found.gitDir, "grisha-task") }
}

function parseSheet(text: string): Sheet | string[] {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return [`The sheet is not valid JSON: ${(error as Error).message}`]
  }
  const problems: string[] = []
  if (!isText(raw.task)) problems.push(`"task" must say what the task is, in a sentence.`)
  if (!Array.isArray(raw.boxes)) problems.push(`"boxes" must be a list, one entry per module the task touches.`)
  if (!Array.isArray(raw.units)) problems.push(`"units" must be a list of build steps, in order.`)
  const boxes = list(raw.boxes) as Box[]
  const units = list(raw.units) as Unit[]

  const boxNames = boxes.map((box) => box.name)
  boxes.forEach((box, index) => {
    const at = labelled("boxes", index, box.name)
    const paths = list(box.paths)
    if (!isText(box.name)) problems.push(`${at} needs a "name".`)
    else if (boxNames.indexOf(box.name) !== index) problems.push(`${at}: two boxes share this name.`)
    if (paths.length === 0 || !paths.every(isText)) problems.push(`${at} needs "paths": the files or folders it covers, such as ["src/inbox/**"].`)
    for (const called of box.calls ?? []) if (!boxNames.includes(called)) problems.push(`${at} calls "${called}", which is not a box.`)
  })

  const ids = units.flatMap((unit) => (list(unit.claims) as Claim[]).map((claim) => claim.id))
  units.forEach((unit, index) => {
    const at = labelled("units", index, unit.name)
    const touches = list(unit.touches) as string[]
    const claims = list(unit.claims) as Claim[]
    if (!isText(unit.name)) problems.push(`${at} needs a "name".`)
    if (!KINDS.includes(unit.kind)) problems.push(`${at}: "kind" must be one of ${oneOf(KINDS)}.`)
    if (touches.length === 0) problems.push(`${at} needs "touches": the boxes it changes.`)
    for (const touched of touches)
      if (!boxNames.includes(touched)) problems.push(`${at} touches "${touched}", which is not a box. Boxes: ${boxNames.join(", ") || "none yet"}.`)
    if (claims.length === 0) problems.push(`${at} has no claims. Say what this unit proves or keeps true.`)
    for (const claim of claims) {
      const where = `${at}, claim ${isText(claim.id) ? `"${claim.id}"` : "without an id"}`
      if (!isText(claim.id) || !/^[a-z0-9-]+$/.test(claim.id)) problems.push(`${where}: "id" must be lowercase letters, digits and dashes.`)
      else if (ids.indexOf(claim.id) !== ids.lastIndexOf(claim.id)) problems.push(`${where}: two claims share this id.`)
      if (!isText(claim.says)) problems.push(`${where} needs "says": the claim in plain words.`)
      if (!ROLES.includes(claim.role)) problems.push(`${where}: "role" must be one of ${oneOf(ROLES)}.`)
      for (const box of claim.about ?? []) if (!boxNames.includes(box)) problems.push(`${where} is about "${box}", which is not a box.`)
      if (claim.check === null) continue
      if (typeof claim.check !== "object" || !HOWS.includes(claim.check.how)) problems.push(`${where}: "check" must be null or have "how", one of ${oneOf(HOWS)}.`)
      else if (claim.check.how === "person reads" && claim.check.run !== undefined) problems.push(`${where}: a "person reads" check has no "run".`)
      else if (claim.check.how !== "person reads" && !isText(claim.check.run)) problems.push(`${where}: a "${claim.check.how}" check needs "run", the command that proves it.`)
    }
  })
  return problems.length > 0 ? problems : { task: raw.task as string, boxes, units }
}

export function startTask(world: World, here: Place, title: string): { path: string; existed: boolean } {
  const path = join(taskDir(here, slug(title)), "sheet.json")
  const existed = world.read(path) !== null
  if (!existed) world.write(path, `${JSON.stringify({ task: title, boxes: [], units: [] }, null, 2)}\n`)
  world.write(here.pointer, `${slug(title)}\n`)
  return { path, existed }
}

export function currentTask(world: World, here: Place): Task | Broken | null {
  const name = world.read(here.pointer)?.trim()
  if (!name) return null
  const dir = taskDir(here, name)
  const path = join(dir, "sheet.json")
  const text = world.read(path)
  const sheet = text === null ? [`There is no sheet at ${path}.`] : parseSheet(text)
  if (Array.isArray(sheet)) return { path, problems: sheet }
  const approved = world.read(join(dir, "approved.json"))
  return {
    dir,
    sheet,
    runs: lines(world.read(join(dir, "runs.jsonl")) ?? "").map((line) => JSON.parse(line) as Run),
    approval: approved === null ? "not approved" : JSON.parse(approved).plan === planHash(sheet) ? "approved" : "changed since it was approved",
  }
}

export function approve(world: World, task: Task): void {
  world.write(join(task.dir, "approved.json"), `${JSON.stringify({ plan: planHash(task.sheet), at: world.now().toISOString() })}\n`)
}

function fingerprinter(world: World, root: string, sheet: Sheet): (unit: Unit, claim: Claim) => string {
  let files: string[] | undefined
  const hashes = new Map<string, string>()
  const prints = new Map<string, string>()
  return (unit, claim) => {
    const boxes = claim.about ?? unit.touches
    const key = boxes.join("\n")
    const known = prints.get(key)
    if (known !== undefined) return known
    files ??= everyFile(world).sort()
    const paths = pathsOf(sheet, boxes)
    const print = sha(
      files
        .filter((path) => matches(path, paths))
        .map((path) => {
          if (!hashes.has(path)) hashes.set(path, sha(world.read(join(root, path)) ?? ""))
          return `${path} ${hashes.get(path)}`
        })
        .join("\n"),
    )
    prints.set(key, print)
    return print
  }
}

export function runnable(sheet: Sheet): Runnable[] {
  return sheet.units.flatMap((unit) => unit.claims.flatMap((claim) => (claim.check?.run ? [{ unit, claim, run: claim.check.run }] : [])))
}

export function runCheck(world: World, here: Place, task: Task, { unit, claim, run }: Runnable): Run {
  const ran = world.sh(run, here.root)
  const evidence = join(task.dir, "evidence", `${claim.id}-${task.runs.filter((earlier) => earlier.claim === claim.id).length + 1}.txt`)
  world.write(evidence, ran.out)
  const record = { claim: claim.id, run, at: world.now().toISOString(), exit: ran.code, fingerprint: fingerprinter(world, here.root, task.sheet)(unit, claim), evidence }
  world.append(join(task.dir, "runs.jsonl"), `${JSON.stringify(record)}\n`)
  return record
}

function statusOf(claim: Claim, runs: Run[], fingerprint: () => string): Status {
  if (claim.check === null) return "no check"
  if (claim.check.how === "person reads") return "for you to read"
  const command = claim.check.run
  const mine = runs.filter((run) => run.claim === claim.id && run.run === command)
  const last = mine.at(-1)
  if (!last) return "not run"
  if (last.exit !== 0) return "failing"
  if (last.fingerprint !== fingerprint()) return "stale"
  return mine.some((run) => run.exit !== 0) ? "proven" : "passes, never seen failing"
}

export function view(world: World, here: Place, task: Task): View {
  const fingerprint = fingerprinter(world, here.root, task.sheet)
  return {
    task: task.sheet.task,
    approval: task.approval,
    boxes: task.sheet.boxes,
    units: task.sheet.units.map((unit) => ({
      ...unit,
      claims: unit.claims.map((claim) => ({ ...claim, status: statusOf(claim, task.runs, () => fingerprint(unit, claim)) })),
    })),
  }
}

export const claimsOf = (units: View["units"]) => units.flatMap((unit) => unit.claims)

export function blocking(seen: View, at: Moment): string[] {
  return claimsOf(seen.units).flatMap((claim) => {
    const block = BLOCKS[claim.status]
    return block && (block.at === "commit" || at === "push") ? [block.fix(claim.id)] : []
  })
}

export function outsidePlan(world: World, task: Task, base: string): string[] {
  const planned = task.sheet.boxes.flatMap((box) => box.paths)
  return changedFiles(world, base).filter((file) => !matches(file, planned))
}
