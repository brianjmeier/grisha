#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { main } from "../src/main"
import { realIO, type World } from "../src/world"

const SHEET = `{
  "task": "Count only unread rows",
  "boxes": [
    { "name": "inbox/count", "paths": ["src/inbox/**", "test/**"], "calls": ["inbox/store"] },
    { "name": "inbox/store", "paths": ["src/store/**"] }
  ],
  "units": [
    {
      "name": "count unread rows",
      "kind": "change",
      "touches": ["inbox/count"],
      "claims": [
        { "id": "counts-unread", "says": "the badge shows the number of unread rows", "role": "proves",
          "check": { "how": "script", "run": "sh test/unread.test.sh" } },
        { "id": "still-a-number", "says": "the badge still shows a number", "role": "keeps",
          "check": { "how": "script", "run": "sh test/number.test.sh" } },
        { "id": "other-tenants", "says": "another tenant's rows never count", "role": "keeps", "check": null }
      ]
    }
  ]
}`

const temp = (name: string) => realpathSync(mkdtempSync(join(tmpdir(), `grisha-${name}-`)))

export async function session(now: () => Date): Promise<string> {
  const home = temp("home")
  const root = join(temp("code"), "shop")
  const shown: string[] = []
  const tidy = (text: string) => text.replaceAll(home, "~/.grisha").replaceAll(root, "~/code/shop")
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root })
  const note = (text: string) => shown.push("", `# ${text}`)
  const grisha = async (args: string[], ask: World["ask"] = null) => {
    const printed: string[] = []
    shown.push(`$ grisha ${args.map((word) => (word.includes(" ") ? `"${word}"` : word)).join(" ")}`)
    const code = await main(args, {
      ...realIO(root),
      home,
      now,
      input: () => "",
      hostApproves: false,
      ask,
      print: (text) => {
        printed.push(text)
        shown.push(tidy(text))
      },
    })
    if (code !== 0) shown.push(`(exit ${code})`)
    return printed.join("\n")
  }

  mkdirSync(root, { recursive: true })
  git("init", "-q", "-b", "main")
  git("config", "user.email", "someone@example.com")
  git("config", "user.name", "Someone")
  put("src/inbox/count.sh", "echo 3\n")
  put("test/unread.test.sh", '[ "$(sh src/inbox/count.sh)" = "2" ]\n')
  put("test/number.test.sh", 'sh src/inbox/count.sh | grep -Eq "^[0-9]+$"\n')
  git("add", ".")
  git("commit", "-q", "-m", "start")

  shown.push("# Once on your machine: the starter rules.")
  await grisha(["rules", "--init"])

  note("The badge counts every row and should count only unread ones. The agent starts a sheet.")
  const sheet = ((await grisha(["start", "Count only unread rows"])).split("\n")[0] ?? "").replace(/^[^:]*: /, "")

  note("The agent writes its plan into the sheet, then reads it back.")
  writeFileSync(sheet, `${SHEET}\n`)
  shown.push(`$ cat ${tidy(sheet)}`, SHEET)
  await grisha(["show"])

  note("The agent tries to approve its own plan.")
  await grisha(["approve"])

  note("You approve it, in your own terminal.")
  await grisha(["approve"], async (question) => {
    shown.push(tidy(`${question}yes`))
    return "yes"
  })

  note("Before any change, the agent runs the checks. The new behaviour must fail first.")
  await grisha(["run"])

  note("The agent makes the change and runs that check again.")
  put("src/inbox/count.sh", "echo 2\n")
  await grisha(["run", "counts-unread"])

  note("The agent tries to commit.")
  await grisha(["gate"])

  note("It runs the stale check again.")
  await grisha(["run", "still-a-number"])

  note("That check has never failed, so it has not shown it can. The agent breaks the code on purpose and runs it.")
  put("src/inbox/count.sh", "echo many\n")
  await grisha(["run", "still-a-number"])

  note("It restores the code and runs the check once more.")
  put("src/inbox/count.sh", "echo 2\n")
  await grisha(["run", "still-a-number"])

  note("Now the commit goes through.")
  await grisha(["gate"])

  note("The agent tries to push.")
  await grisha(["gate", "--final"])

  note("The agent also edits a file the plan never mentioned, and leaves a comment in it.")
  put("src/billing.ts", "// TODO: bill unread rows only\nexport const rate = 2\n")
  await grisha(["rules"])

  note("Instead of deleting the comment, the agent turns the rule off for this repository.")
  const mine = join(home, "repos", "shop", "rules.json")
  writeFileSync(mine, `${JSON.stringify({ rules: [{ name: "no-new-comments", off: true }] })}\n`)
  await grisha(["gate"])

  note("You do not approve that. The agent puts the rule back and deletes the comment.")
  rmSync(mine)
  put("src/billing.ts", "export const rate = 2\n")
  await grisha(["outside"])

  note("The proof, as a section for the pull request.")
  await grisha(["pr"])

  return `${shown.join("\n")}\n`
}

if (import.meta.main) process.stdout.write(await session(() => new Date()))
