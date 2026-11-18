import { basename, dirname, join } from "node:path"
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

type Git = Pick<World, "git">

export class GitProblem extends Error {}

function git(world: Git, args: string[]): string {
  const ran = world.git(args)
  if (ran.code !== 0) throw new GitProblem(`git ${args.join(" ")} failed:\n${ran.out.trim()}\ngrisha reads the checkout through git. Fix what git reports, then run the same grisha command again.`)
  return ran.out
}

export function checkout(world: Git): { root: string; gitDir: string; name: string } | null {
  const found = world.git(["rev-parse", "--show-toplevel", "--absolute-git-dir", "--path-format=absolute", "--git-common-dir"])
  if (found.code !== 0) return null
  const [root = "", gitDir = "", shared = ""] = lines(found.out)
  const origin = world.git(["remote", "get-url", "origin"])
  const name = origin.code === 0 ? origin.out.trim().replace(/\.git$/, "").split(/[/:]/).slice(-2).join("-") : basename(dirname(shared))
  return { root, gitDir, name }
}

export function baseOf(world: Git, wanted?: string): string {
  for (const ref of wanted ? [wanted] : ["origin/HEAD", "origin/main", "main", "master"]) {
    const merged = world.git(["merge-base", "HEAD", ref])
    if (merged.code === 0) return merged.out.trim()
  }
  if (wanted) throw new GitProblem(`No branch or commit called "${wanted}" shares history with this one. --base takes the branch this one started from.`)
  return world.git(["rev-parse", "--verify", "--quiet", "HEAD"]).code === 0 ? "HEAD" : EMPTY_TREE
}

export function committed(world: Git, base: string, path: string): string | null {
  const shown = world.git(["show", `${base}:${path}`])
  return shown.code === 0 ? shown.out : null
}

export function fetched(world: Git, repository: string): string {
  git(world, ["fetch", "--quiet", repository, "HEAD"])
  return git(world, ["rev-parse", "FETCH_HEAD"]).trim()
}

export const filesAt = (world: Git, commit: string, folder: string) => lines(git(world, ["ls-tree", "-r", "--name-only", "--full-tree", commit, "--", folder]))

const untracked = (world: Git) => lines(git(world, ["ls-files", "--others", "--exclude-standard", "--full-name", ":/"]))

export function everyFile(world: Git): string[] {
  return [...lines(git(world, ["ls-files", "--full-name", ":/"])), ...untracked(world)]
}

export function changedFiles(world: Git, base: string): string[] {
  return [...lines(git(world, ["diff", "--name-only", base, "--", ":/"])), ...untracked(world)]
}

export function addedLines(world: Git & Pick<World, "read">, root: string, base: string, wanted: string[]): Added[] {
  const added: Added[] = []
  let file = ""
  let line = 0
  let header = true
  let keep = false
  for (const row of git(world, ["diff", "--unified=0", "--no-color", "--no-ext-diff", base, "--", ":/"]).split("\n")) {
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
