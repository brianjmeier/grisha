import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

type Ran = { code: number; out: string }

export type World = {
  home: string
  now: () => Date
  confirm: (plan: string) => Promise<"yes" | "no" | "unavailable">
  input: () => string
  print: (text: string) => void
  read: (path: string) => string | null
  write: (path: string, text: string) => void
  append: (path: string, text: string) => void
  git: (args: string[]) => Ran
  sh: (command: string, cwd: string) => Ran
}

export function realWorld(cwd: string, given: Pick<World, "home" | "now" | "confirm" | "input">): World {
  const prepare = (path: string) => mkdirSync(dirname(path), { recursive: true })
  return {
    ...given,
    print: (text) => console.log(text),
    read: (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
    write: (path, text) => {
      prepare(path)
      writeFileSync(path, text)
    },
    append: (path, text) => {
      prepare(path)
      appendFileSync(path, text)
    },
    git: (args) => {
      const ran = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
      return { code: ran.exitCode, out: (ran.exitCode === 0 ? ran.stdout : ran.stderr).toString() }
    },
    sh: (command, at) => {
      const ran = Bun.spawnSync(["sh", "-c", `${command} 2>&1`], { cwd: at, stdout: "pipe" })
      return { code: ran.exitCode, out: ran.stdout.toString() }
    },
  }
}
