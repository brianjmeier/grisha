#!/usr/bin/env bun
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline/promises"
import { main } from "../src/main"
import { realWorld } from "../src/world"

const world = realWorld(process.cwd(), {
  home: process.env.PROOFSHEET_HOME ?? join(homedir(), ".proofsheet"),
  now: () => new Date(),
  input: () => (process.stdin.isTTY ? "" : readFileSync(0, "utf8")),
  confirm: async (shown) => {
    if (process.env.PROOFSHEET_HOST_APPROVES === "1") return "yes"
    if (!process.stdin.isTTY) return "unavailable"
    const terminal = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await terminal.question(`${shown}\n\nApprove this? Type yes: `)
    terminal.close()
    return answer.trim().toLowerCase() === "yes" ? "yes" : "no"
  },
})

process.exit(await main(process.argv.slice(2), world))
