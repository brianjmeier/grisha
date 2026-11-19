import { join } from "node:path"
import { addedLines, committed, everyFile, linesOf, matches, type Added } from "./changes"
import { counted, isText, labelled, lines } from "./text"
import type { World } from "./world"

const BLOCKS = ["added lines", "every line", "nothing"] as const

type Rule = { name: string; pattern: string; files: string[]; fix: string; blocks: (typeof BLOCKS)[number] }
type Catch = Added & { rule: string; fix: string; added: boolean; blocked: boolean }

type Written = Omit<Rule, "files" | "blocks"> & { files: string | string[]; blocks?: Rule["blocks"] }
type Entry = Written | { name: string; off: true }
type RulesFile = { files?: Record<string, string[]>; rules?: Entry[] }
type Loaded = { rules: Rule[]; groups: Map<string, string[]>; problems: string[] }

type Checkout = { root: string; home: string }

const RULES_APPROVE_HINT = "Run `grisha rules --approve`: the person is shown what changed and asked."

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
  if (rule.blocks !== undefined && !BLOCKS.includes(rule.blocks)) return `has "blocks": ${JSON.stringify(rule.blocks)}. It is ${BLOCKS.map((one) => `"${one}"`).join(", ")}, and "${BLOCKS[0]}" when left out.`
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
    if (files) return [{ ...rule, files, blocks: rule.blocks ?? BLOCKS[0] }]
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
    const parts = (["pattern", "files", "fix", "blocks"] as const).flatMap((part) => {
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

function catches(world: World, here: Checkout, base: string, rules: Rule[], everywhere: boolean): Catch[] {
  const added = Map.groupBy(addedLines(world, here.root, base, rules.flatMap((rule) => rule.files)), (row) => row.file)
  const reading = rules.map((rule) => ({ rule, pattern: new RegExp(rule.pattern), wholeFile: everywhere || rule.blocks === "every line", found: [] as Catch[] }))
  for (const file of reading.some((one) => one.wholeFile) ? everyFile(world) : added.keys()) {
    const fresh = (added.get(file) ?? []).map((row) => ({ ...row, added: true }))
    let merged: typeof fresh | undefined
    const everyRow = () => {
      if (merged) return merged
      const addedAt = new Set(fresh.map((row) => row.line))
      const old = linesOf(world, here.root, file).filter((row) => !addedAt.has(row.line))
      return (merged = [...fresh, ...old.map((row) => ({ ...row, added: false }))].sort((one, other) => one.line - other.line))
    }
    for (const { rule, pattern, wholeFile, found } of reading) {
      if (!matches(file, rule.files)) continue
      for (const row of wholeFile ? everyRow() : fresh) {
        if (pattern.test(row.text)) found.push({ ...row, rule: rule.name, fix: rule.fix, blocked: rule.blocks === "every line" || (row.added && rule.blocks === "added lines") })
      }
    }
  }
  return reading.flatMap((one) => one.found)
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

const shown = (one: Catch) => `${one.file}:${one.line}  ${one.rule}\n  ${one.added ? "+" : " "} ${one.text.trim()}\n  ${one.fix}`

function check(world: World, here: Checkout, base: string, files: Files, everywhere: boolean): { wrong: string[]; rules: Rule[]; found: Catch[] } {
  const loaded = loadRules(files)
  if (loaded.problems.length > 0) return { wrong: loaded.problems, rules: [], found: [] }
  const unapproved = unapprovedRules(files, loaded)
  const wrong = unapproved.length > 0 ? [["The rules here are not the ones the person approved:", ...unapproved, RULES_APPROVE_HINT].join("\n  ")] : []
  return { wrong, rules: loaded.rules, found: loaded.rules.length === 0 ? [] : catches(world, here, base, loaded.rules, everywhere) }
}

export function brokenRules(world: World, here: Checkout, base: string, files: Files = ruleFiles(world, here, base)): { broken: string[]; caught: Catch[]; notBlocked: number } {
  const { wrong, found } = check(world, here, base, files, false)
  const caught = found.filter((one) => one.blocked)
  return { broken: [...wrong, ...caught.map(shown)], caught, notBlocked: found.length - caught.length }
}

export function everyMatch(world: World, here: Checkout, base: string, files: Files, named: string[]) {
  const { wrong, rules, found } = check(world, here, base, files, true)
  const wanted = rules.filter((rule) => named.length === 0 || named.includes(rule.name))
  const mine = found.filter((one) => wanted.some((rule) => rule.name === one.rule))
  const caught = mine.filter((one) => one.blocked)
  const width = (words: readonly string[]) => Math.max(0, ...words.map((word) => word.length))
  const [names, settings] = [width(wanted.map((rule) => rule.name)), width(BLOCKS)]
  const table = wanted.map((rule) => {
    const old = mine.filter((one) => one.rule === rule.name && !one.added)
    const already = old.length === 0 ? "none" : `${counted(old.length, "line")} in ${counted(new Set(old.map((one) => one.file)).size, "file")}`
    return `  ${rule.name.padEnd(names)}  ${rule.blocks.padEnd(settings)}  ${already}`
  })
  const notBlocked = wanted.flatMap((rule) => {
    const rows = mine.filter((one) => one.rule === rule.name && !one.blocked && (one.added || named.length > 0))
    return rows.length === 0 ? [] : [`${rule.name}: ${rule.fix}`, ...rows.map((one) => `  ${one.file}:${one.line}  ${one.added ? "+" : " "} ${one.text.trim()}`)]
  })
  return { broken: [...wrong, ...caught.map(shown)], caught, notBlocked, table }
}
