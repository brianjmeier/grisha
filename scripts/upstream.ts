#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { basename, dirname, join } from "node:path"
import { checkout, committed, everyFile, fetched, filesAt, GitProblem, matches } from "../src/changes"
import { realIO, type World } from "../src/world"

type Port = { repository: string; folder: string; commit: string; sources: Record<string, string>; skipped?: string[] }

const short = (commit: string) => commit.slice(0, 7)
const sha = (text: string) => createHash("sha256").update(text).digest("hex")

export function upstream(world: Pick<World, "git" | "read" | "print">): number {
  const here = checkout(world)
  if (!here) {
    world.print("Run this inside the proofsheet repository.")
    return 2
  }
  const heads = new Map<string, string>()
  let drifted = 0

  for (const path of everyFile(world).filter((file) => matches(file, ["skills/*/UPSTREAM.json"]))) {
    const port: Port = JSON.parse(world.read(join(here.root, path)) ?? "{}")
    const skill = basename(dirname(path))
    if (!heads.has(port.repository)) {
      heads.set(port.repository, fetched(world, port.repository))
      world.print(`${port.repository} is at ${short(heads.get(port.repository) ?? "")}`)
    }
    const head = heads.get(port.repository) ?? ""
    const theirs = filesAt(world, head, `${port.folder}/skills/${skill}`).map((file) => file.slice(port.folder.length + 1))
    const rows = [
      ...Object.entries(port.sources).flatMap(([source, recorded]) => {
        const now = committed(world, head, `${port.folder}/${source}`)
        if (now === null) return [`gone upstream     ${source}`]
        return sha(now) === recorded ? [] : [`changed upstream  ${source}`]
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
  try {
    process.exit(upstream(realIO(process.cwd())))
  } catch (error) {
    if (!(error instanceof GitProblem)) throw error
    console.error(error.message)
    process.exit(2)
  }
}
