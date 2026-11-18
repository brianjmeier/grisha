import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

type Ran = { code: number; out: string }

export type World = {
  home: string
  now: () => Date
  approved: string | null
  ask: ((question: string) => Promise<string>) | null
  input: () => string
  at: (folder: string) => World
  print: (text: string) => void
  read: (path: string) => string | null
  write: (path: string, text: string) => void
  append: (path: string, text: string) => void
  git: (args: string[]) => Ran
  sh: (command: string, cwd: string) => Ran
}

export function realIO(cwd: string): Pick<World, "print" | "read" | "write" | "append" | "git" | "sh"> {
  const prepare = (path: string) => mkdirSync(dirname(path), { recursive: true })
  return {
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
      if (!existsSync(cwd)) return { code: 128, out: `${cwd} does not exist` }
      const ran = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
      return { code: ran.exitCode, out: (ran.exitCode === 0 ? ran.stdout : ran.stderr).toString() }
    },
    sh: (command, at) => {
      const ran = Bun.spawnSync(["sh", "-c", `${command} 2>&1`], { cwd: at, stdout: "pipe" })
      return { code: ran.exitCode, out: ran.stdout.toString() }
    },
  }
}
