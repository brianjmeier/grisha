#!/usr/bin/env bun
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline/promises"
import { main } from "../src/main"
import { realIO } from "../src/world"

const inTerminal = process.stdin.isTTY

async function ask(question: string): Promise<string> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await terminal.question(question)
  terminal.close()
  return answer
}

process.exit(
  await main(process.argv.slice(2), {
    ...realIO(process.cwd()),
    home: process.env.GRISHA_HOME ?? join(homedir(), ".grisha"),
    now: () => new Date(),
    input: () => (inTerminal ? "" : readFileSync(0, "utf8")),
    hostApproves: process.env.GRISHA_HOST_APPROVES === "1",
    ask: inTerminal ? ask : null,
  }),
)
