#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { basename, dirname, join } from "node:path"
import { matches } from "../src/changes"
import { lines } from "../src/text"
import { realWorld, type World } from "../src/world"

type Port = { repository: string; folder: string; commit: string; sources: Record<string, string>; skipped?: string[] }

const short = (commit: string) => commit.slice(0, 7)
const sha = (text: string) => createHash("sha256").update(text).digest("hex")

export function upstream(world: Pick<World, "git" | "read" | "print">): number {
  const records = world.git(["ls-files", "--cached", "--others", "--exclude-standard", "--full-name", ":/skills/*/UPSTREAM.json"])
  if (records.code !== 0) {
    world.print("Run this inside the proofsheet repository.")
    return 2
  }
  const root = world.git(["rev-parse", "--show-toplevel"]).out.trim()
  const heads = new Map<string, string>()
  let drifted = 0

  for (const path of lines(records.out)) {
    const port: Port = JSON.parse(world.read(join(root, path)) ?? "{}")
    const skill = basename(dirname(path))
    if (!heads.has(port.repository)) {
      if (world.git(["fetch", "--quiet", port.repository, "HEAD"]).code !== 0) {
        world.print(`Could not fetch ${port.repository}.`)
        return 2
      }
      heads.set(port.repository, world.git(["rev-parse", "FETCH_HEAD"]).out.trim())
      world.print(`${port.repository} is at ${short(heads.get(port.repository) ?? "")}`)
    }
    const head = heads.get(port.repository) ?? ""
    const theirs = lines(world.git(["ls-tree", "-r", "--name-only", "--full-tree", head, "--", `${port.folder}/skills/${skill}`]).out)
      .map((file) => file.slice(port.folder.length + 1))
    const rows = [
      ...Object.entries(port.sources).flatMap(([source, recorded]) => {
        const now = world.git(["show", `${head}:${port.folder}/${source}`])
        if (now.code !== 0) return [`gone upstream     ${source}`]
        return sha(now.out) === recorded ? [] : [`changed upstream  ${source}`]
      }),
      ...theirs.filter((file) => !(file in port.sources) && !matches(file, port.skipped ?? [])).map((file) => `new upstream      ${file}`),
    ]
    if (rows.length === 0) continue
    drifted += 1
    world.print(["", `${skill}, taken at ${short(port.commit)}`, ...rows.map((row) => `  ${row}`)].join("\n"))
  }

  world.print(
    drifted === 0
      ? "No ported file changed upstream."
      : "\nNothing was changed here. Bring each file over by hand, then update the commit and checksums in its UPSTREAM.json.",
  )
  return drifted === 0 ? 0 : 1
}

if (import.meta.main) {
  const world = realWorld(process.cwd(), { home: "", now: () => new Date(), confirm: async () => "unavailable", input: () => "" })
  process.exit(upstream(world))
}
