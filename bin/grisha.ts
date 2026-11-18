#!/usr/bin/env bun
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { createInterface } from "node:readline/promises"
import { main } from "../src/main"
import { realIO, type World } from "../src/world"

const inTerminal = process.stdin.isTTY

async function ask(question: string): Promise<string> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await terminal.question(question)
  terminal.close()
  return answer
}

const world = (cwd: string): World => ({
  ...realIO(cwd),
  home: process.env.GRISHA_HOME ?? join(homedir(), ".grisha"),
  now: () => new Date(),
  input: () => (inTerminal ? "" : readFileSync(0, "utf8")),
  approved: process.env.GRISHA_APPROVED ?? null,
  ask: inTerminal ? ask : null,
  at: (folder) => world(resolve(cwd, folder === "~" || folder.startsWith("~/") ? join(homedir(), folder.slice(1)) : folder)),
})

process.exit(await main(process.argv.slice(2), world(process.cwd())))
