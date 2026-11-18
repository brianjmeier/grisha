import { join } from "node:path"
import { addedLines, committed, matches, type Added } from "./changes"
import { isText, labelled, lines } from "./text"
import type { World } from "./world"

type Rule = { name: string; pattern: string; files: string[]; fix: string }
type Catch = Added & { rule: string; fix: string }

type Written = Omit<Rule, "files"> & { files: string | string[] }
type Entry = Written | { name: string; off: true }
type RulesFile = { files?: Record<string, string[]>; rules?: Entry[] }
type Loaded = { rules: Rule[]; groups: Map<string, string[]>; problems: string[] }

type Checkout = { root: string; home: string }

export const RULES_APPROVE_HINT = "The person approves them by running `grisha rules --approve` in their own terminal."

const COMMITTED = join(".grisha", "rules.json")

export function ruleFiles(world: World, here: Checkout, base: string) {
  const yours = (covers: string, folder: string) => {
    const path = join(folder, "rules.json")
    const approved = join(folder, "rules.approved.json")
    return { covers, path, text: world.read(path), approved: world.read(approved), approvedAt: approved, waits: false }
  }
  const text = committed(world, base, COMMITTED)
  const path = join(here.root, COMMITTED)
  return [
    yours("every repository", world.home),
    { covers: "this repository, committed", path, text, approved: text, approvedAt: null, waits: world.read(path) !== text },
    yours("this repository, only you", here.home),
  ]
}

type Files = ReturnType<typeof ruleFiles>

const isPatterns = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every(isText)

function flaw(rule: Written): string | null {
  if (![rule.pattern, rule.fix].every(isText)) return 'needs "pattern" and "fix", or "off": true to turn off a rule from an earlier file.'
  if (!isText(rule.files) && !isPatterns(rule.files)) return 'needs "files": the name of a file group such as "tests", or patterns such as ["**/*.tsx"].'
  try {
    new RegExp(rule.pattern)
    return null
  } catch (error) {
    return `has a "pattern" that is not a valid regular expression: ${(error as Error).message}`
  }
}

export function loadRules(files: { path: string; text: string | null }[]): Loaded {
  const written = new Map<string, Written & { at: string }>()
  const groups = new Map<string, string[]>()
  const problems: string[] = []
  for (const { path, text } of files) {
    if (!text) continue
    let file: RulesFile
    try {
      file = JSON.parse(text)
    } catch (error) {
      problems.push(`${path} is not valid JSON: ${(error as Error).message}`)
      continue
    }
    const shaped = file !== null && typeof file === "object" && !Array.isArray(file) && Array.isArray(file.rules ?? []) && typeof (file.files ?? {}) === "object"
    if (!shaped) {
      problems.push(`${path} must look like { "files": { "tests": ["**/*.test.*"] }, "rules": [ ... ] }. Either part can be left out.`)
      continue
    }
    for (const [name, patterns] of Object.entries(file.files ?? {})) {
      if (isPatterns(patterns)) groups.set(name, patterns)
      else problems.push(`${path}: file group "${name}" needs a list of patterns, such as ["**/*.test.*"].`)
    }
    ;(file.rules ?? []).forEach((entry, index) => {
      const at = `${path}: ${labelled("rules", index, entry?.name)}`
      if (!isText(entry?.name)) problems.push(`${at} needs "name".`)
      else if ("off" in entry && entry.off === true) {
        if (!written.delete(entry.name)) problems.push(`${at} turns off a rule that no earlier file has.`)
      } else {
        const wrong = flaw(entry as Written)
        if (wrong) problems.push(`${at} ${wrong}`)
        else written.set(entry.name, { ...(entry as Written), at })
      }
    })
  }
  const rules = [...written.values()].flatMap(({ at, ...rule }) => {
    const files = typeof rule.files === "string" ? groups.get(rule.files) : rule.files
    if (files) return [{ ...rule, files }]
    problems.push(`${at} applies to the file group "${rule.files}", which no rules file defines under "files".`)
    return []
  })
  return { rules: problems.length > 0 ? [] : rules, groups, problems }
}

export function unapprovedRules(files: Files, now: Loaded = loadRules(files)): string[] {
  if (now.problems.length > 0) return []
  const approved = loadRules(files.map((file) => ({ path: file.path, text: file.approved })))
  const was = new Map(approved.rules.map((rule) => [rule.name, rule]))
  const names = new Set(now.rules.map((rule) => rule.name))
  const gone = [...was.keys()].filter((name) => !names.has(name))
  const added = now.rules.filter((rule) => !was.has(rule.name)).map((rule) => rule.name)
  const changed = now.rules.flatMap((rule) => {
    const before = was.get(rule.name)
    if (!before) return []
    const parts = (["pattern", "files", "fix"] as const).flatMap((part) => {
      const [old, current] = [before[part], rule[part]].map((value) => [value].flat().join("  "))
      return old === current ? [] : [`  ${part}: ${old}  →  ${current}`]
    })
    return parts.length > 0 ? [`changed: ${rule.name}`, ...parts] : []
  })
  return [...(gone.length > 0 ? [`no longer in force: ${gone.join(", ")}`] : []), ...(added.length > 0 ? [`new: ${added.join(", ")}`] : []), ...changed]
}

export function approveRules(world: World, files: Files): void {
  for (const file of files) if (file.approvedAt) world.write(file.approvedAt, file.text ?? "")
}

function catches(rules: Rule[], added: Added[]): Catch[] {
  return rules.flatMap((rule) => {
    const pattern = new RegExp(rule.pattern)
    return added.filter((row) => pattern.test(row.text) && matches(row.file, rule.files)).map((row) => ({ ...row, rule: rule.name, fix: rule.fix }))
  })
}

export function recordCatches(world: World, home: string, caught: Catch[]): void {
  if (caught.length === 0) return
  const log = join(home, "catches.jsonl")
  const known = new Set(lines(world.read(log) ?? "").map((line) => JSON.parse(line).key))
  for (const one of caught) {
    const key = `${one.rule} ${one.file} ${one.text.trim()}`
    if (known.has(key)) continue
    known.add(key)
    world.append(log, `${JSON.stringify({ key, at: world.now().toISOString(), rule: one.rule, file: one.file })}\n`)
  }
}

export function brokenRules(world: World, here: Checkout, base: string, files: Files = ruleFiles(world, here, base)): { broken: string[]; caught: Catch[] } {
  const loaded = loadRules(files)
  if (loaded.problems.length > 0) return { broken: loaded.problems, caught: [] }
  const unapproved = unapprovedRules(files, loaded)
  const drift = unapproved.length > 0 ? [["The rules here are not the ones the person approved:", ...unapproved, RULES_APPROVE_HINT].join("\n  ")] : []
  if (loaded.rules.length === 0) return { broken: drift, caught: [] }
  const caught = catches(loaded.rules, addedLines(world, here.root, base, loaded.rules.flatMap((rule) => rule.files)))
  return { broken: [...drift, ...caught.map((one) => `${one.file}:${one.line}  ${one.rule}\n  + ${one.text.trim()}\n  ${one.fix}`)], caught }
}
