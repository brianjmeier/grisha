import { join } from "node:path"
import { lines } from "./text"
import type { World } from "./world"

export type Added = { file: string; line: number; text: string }

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
const LARGEST_NEW_FILE = 1_000_000

export function matches(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (/[*?[{]/.test(pattern)) return new Bun.Glob(pattern).match(path)
    const folder = pattern.replace(/\/$/, "")
    return path === folder || path.startsWith(`${folder}/`)
  })
}

export function baseOf(world: World, wanted?: string): string {
  for (const ref of wanted ? [wanted] : ["origin/HEAD", "origin/main", "main", "master"]) {
    const merged = world.git(["merge-base", "HEAD", ref])
    if (merged.code === 0) return merged.out.trim()
  }
  return world.git(["rev-parse", "--verify", "--quiet", "HEAD"]).code === 0 ? "HEAD" : EMPTY_TREE
}

const untracked = (world: World) => lines(world.git(["ls-files", "--others", "--exclude-standard", "--full-name", ":/"]).out)

export function everyFile(world: World): string[] {
  return [...lines(world.git(["ls-files", "--full-name", ":/"]).out), ...untracked(world)]
}

export function changedFiles(world: World, base: string): string[] {
  return [...lines(world.git(["diff", "--name-only", base, "--", ":/"]).out), ...untracked(world)]
}

export function addedLines(world: World, root: string, base: string, wanted: string[]): Added[] {
  const added: Added[] = []
  let file = ""
  let line = 0
  let header = true
  let keep = false
  for (const row of world.git(["diff", "--unified=0", "--no-color", "--no-ext-diff", base, "--", ":/"]).out.split("\n")) {
    if (row.startsWith("diff --git ")) header = true
    else if (header && row.startsWith("+++ ")) {
      file = row.slice(4).replace(/^b\//, "")
      keep = matches(file, wanted)
    } else if (row.startsWith("@@")) {
      header = false
      line = Number(/\+(\d+)/.exec(row)?.[1] ?? 0)
    } else if (keep && row.startsWith("+")) added.push({ file, line: line++, text: row.slice(1) })
  }
  for (const path of untracked(world).filter((path) => matches(path, wanted))) {
    const text = world.read(join(root, path))
    if (text === null || text.length > LARGEST_NEW_FILE || text.includes("\0")) continue
    text.split("\n").forEach((row, index) => added.push({ file: path, line: index + 1, text: row }))
  }
  return added
}
