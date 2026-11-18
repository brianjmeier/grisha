import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { session } from "../scripts/session"
import { upstream } from "../scripts/upstream"
import { main } from "../src/main"
import { lines } from "../src/text"
import { realIO, type World } from "../src/world"

const temp = (name: string) => realpathSync(mkdtempSync(join(tmpdir(), `grisha-${name}-`)))

const SHEET = {
  task: "Count only unread rows",
  boxes: [{ name: "inbox", paths: ["src/inbox/**", "test/inbox.test.sh"] }],
  units: [
    {
      name: "count unread rows",
      kind: "change",
      touches: ["inbox"],
      claims: [
        { id: "counts-unread", says: "the count is the number of unread rows", role: "proves", check: { how: "script", run: "sh test/inbox.test.sh" } },
        { id: "reads-well", says: "the query is easy to follow", role: "keeps", check: { how: "person reads" } },
      ],
    },
  ],
}

function scene(cwd?: string) {
  const root = cwd ?? temp("repo")
  const home = temp("home")
  const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root })
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  if (!cwd) {
    git("init", "-q", "-b", "main")
    git("config", "user.email", "someone@example.com")
    git("config", "user.name", "Someone")
    put("src/inbox/count.sh", "echo 3\n")
    put("src/other/unrelated.ts", "export const one = 1\n")
    put("test/inbox.test.sh", '[ "$(sh src/inbox/count.sh)" = "2" ]\n')
    git("add", ".")
    git("commit", "-q", "-m", "start")
  }
  const run = async (args: string[], given: Partial<World> = {}) => {
    const printed: string[] = []
    const world = (cwd: string): World => ({
      ...realIO(cwd),
      home,
      now: () => new Date("2026-11-17T12:00:00Z"),
      approved: null,
      ask: async () => "yes",
      input: () => "",
      at: world,
      print: (text) => printed.push(text),
      ...given,
    })
    return { code: await main(args, world(root)), out: printed.join("\n") }
  }
  const share = (rules: unknown) => {
    put(".grisha/rules.json", typeof rules === "string" ? rules : JSON.stringify(rules))
    git("add", ".grisha")
    git("commit", "-q", "-m", "rules")
  }
  let sheet = ""
  const plan = async (written: unknown = SHEET) => {
    sheet = (await run(["start", SHEET.task])).out.split("\n")[0]?.replace(/^[^:]*: /, "") ?? ""
    writeFileSync(sheet, JSON.stringify(written))
  }
  return { root, home, git, put, share, run, plan, sheetPath: () => sheet }
}

test("a new sheet waits for the person's approval", async () => {
  const { run, plan } = scene()
  await plan()
  const shown = await run(["show"])
  expect(shown.out).toContain("plan not approved ·")
  expect(shown.out).toContain("counts-unread: the count is the number of unread rows    [not run]")
  expect((await run(["run"])).out).toContain("Nothing is run before the plan is approved.")
})

test("a sheet that names a missing box says which box and which exist", async () => {
  const { run, plan } = scene()
  await plan({ ...SHEET, units: [{ ...SHEET.units[0], touches: ["mailbox"] }] })
  const shown = await run(["show"])
  expect(shown.code).toBe(1)
  expect(shown.out).toContain('touches "mailbox", which is not a box. Boxes: inbox.')
})

test("only the person approves, and a changed plan needs approving again", async () => {
  const { run, plan, sheetPath } = scene()
  await plan()
  expect((await run(["approve"], { ask: null })).out).toContain("Nobody was asked")
  expect((await run(["approve"], { ask: async () => "y" })).out).toContain("Not approved.")
  expect((await run(["approve"])).out).toContain("The person approved the plan.")
  writeFileSync(sheetPath(), JSON.stringify({ ...SHEET, task: "Count unread and starred rows" }))
  expect((await run(["show"])).out).toContain("plan changed since it was approved")
})

test("a claim is proven only after its check was seen failing, and goes stale when its box changes", async () => {
  const { run, plan, put } = scene()
  await plan()
  await run(["approve"])
  expect((await run(["run"])).out).toContain("1 failing")

  put("src/inbox/count.sh", "echo 2\n")
  expect((await run(["run", "counts-unread"])).out).toContain("1 proven")

  put("src/other/unrelated.ts", "export const one = 2\n")
  expect((await run(["show"])).out).toContain("[proven]")

  put("src/inbox/count.sh", "echo 2 # recount\n")
  expect((await run(["show"])).out).toContain("[stale]")
})

test("a claim about a box its unit does not change goes stale when that box changes", async () => {
  const { run, plan, put } = scene()
  const elsewhere = { id: "other-kept", says: "the other module still loads", role: "keeps", about: ["other"], check: { how: "script", run: "true" } }
  const claims = [SHEET.units[0]?.claims[0], elsewhere]
  await plan({ ...SHEET, boxes: [...SHEET.boxes, { name: "other", paths: ["src/other"] }], units: [{ ...SHEET.units[0], claims }] })
  await run(["approve"])
  put("src/inbox/count.sh", "echo 2\n")
  await run(["run"])
  expect((await run(["show"])).out).toContain("the other module still loads    [passes, never seen failing]")
  put("src/other/unrelated.ts", "export const one = 2\n")
  const shown = (await run(["show"])).out
  expect(shown).toContain("the count is the number of unread rows    [passes, never seen failing]")
  expect(shown).toContain("the other module still loads    [stale]")
})

test("a check that never failed is not called proven until it is seen failing", async () => {
  const { run, plan, put } = scene()
  put("src/inbox/count.sh", "echo 2\n")
  await plan()
  await run(["approve"])
  expect((await run(["run"])).out).toContain("1 passes, never seen failing")
  expect((await run(["gate"])).code).toBe(0)
  expect((await run(["gate", "--proven"])).out).toContain("counts-unread passes but was never seen failing.")

  put("src/inbox/count.sh", "echo 3\n")
  await run(["run"])
  put("src/inbox/count.sh", "echo 2\n")
  expect((await run(["run"])).out).toContain("1 proven")
  expect((await run(["gate", "--proven"])).code).toBe(0)
})

test("a failure seen with an earlier command does not prove the command the claim has now", async () => {
  const { run, plan, put, sheetPath } = scene()
  await plan()
  await run(["approve"])
  await run(["run"])
  put("src/inbox/count.sh", "echo 2\n")
  expect((await run(["run"])).out).toContain("1 proven")

  const weaker = { ...SHEET.units[0]?.claims[0], check: { how: "script", run: "true" } }
  writeFileSync(sheetPath(), JSON.stringify({ ...SHEET, units: [{ ...SHEET.units[0], claims: [weaker] }] }))
  await run(["approve"])
  expect((await run(["show"])).out).toContain("[not run]")
  expect((await run(["run"])).out).toContain("1 passes, never seen failing")
})

test("outside lists changed files that no box covers", async () => {
  const { run, plan, put } = scene()
  await plan()
  put("src/inbox/count.sh", "echo 2\n")
  put("src/other/unrelated.ts", "export const one = 2\n")
  put("src/other/new.ts", "export const two = 2\n")
  const outside = await run(["outside"])
  expect(outside.out).toContain("src/other/unrelated.ts")
  expect(outside.out).toContain("src/other/new.ts")
  expect(outside.out).not.toContain("src/inbox/count.sh")
})

test("rules catch added lines only, and log each catch once", async () => {
  const { run, put, git } = scene()
  put("src/app/Old.tsx", "useEffect(() => {})\n")
  git("add", ".")
  git("commit", "-q", "-m", "old code")
  expect((await run(["rules"])).out).toContain("No rules yet")
  await run(["rules", "--init"])
  expect((await run(["rules"])).out).toContain("No rule is broken")

  put("src/app/Old.tsx", "useEffect(() => {})\nconst kept = 1\n")
  put("src/app/New.tsx", "// waits for the list\nuseEffect(() => {})\n")
  const checked = await run(["rules"])
  expect(checked.code).toBe(1)
  expect(checked.out).toContain("src/app/New.tsx:2  no-new-effects")
  expect(checked.out).toContain("src/app/New.tsx:1  no-new-comments")
  expect(checked.out).not.toContain("Old.tsx")

  const gated = (await run(["gate"])).out
  expect(gated).toContain("- src/app/New.tsx:1  no-new-comments")
  expect(gated).toContain("- src/app/New.tsx:2  no-new-effects")

  await run(["rules"])
  const log = readFileSync(join((await run(["home"])).out, "catches.jsonl"), "utf8")
  expect(lines(log)).toHaveLength(2)
})

test("a repository's rules add to yours, replace one by name and turn one off, for that repository only", async () => {
  const { run, put, share, root, home } = scene()
  const other = scene()
  await run(["rules", "--init"])
  const mine = join((await run(["home"])).out, "rules.json")
  const code = "// waits for the list\nuseEffect(() => {})\nconsole.log(1)\n"
  for (const one of [put, other.put]) {
    one("src/app/New.tsx", code)
    one("src/app/New.test.tsx", "act(() => {})\n")
  }
  share({
    rules: [
      { name: "no-act", pattern: "\\bact\\(", files: "tests", fix: "Wait for what the user sees." },
      { name: "no-new-effects", pattern: "\\buseEffect\\(", files: ["**/*.tsx"], fix: "Use the loader." },
      { name: "no-logging", pattern: "\\bconsole\\.", files: ["**/*.tsx"], fix: "Use the logger." },
    ],
  })
  mkdirSync(dirname(mine), { recursive: true })
  writeFileSync(mine, JSON.stringify({ rules: [{ name: "no-new-comments", off: true }, { name: "no-logging", off: true }] }))
  await run(["rules", "--approve"])

  const here = await run(["rules"])
  expect(lines(here.out).filter((line) => /^\S+:\d+  /.test(line))).toEqual(["src/app/New.tsx:2  no-new-effects", "src/app/New.test.tsx:1  no-act"])
  expect(here.out).toContain("Use the loader.")
  expect(here.out).toContain(join(root, ".grisha", "rules.json"))

  const elsewhere = await other.run(["rules"], { home })
  expect(lines(elsewhere.out).filter((line) => /^\S+:\d+  /.test(line))).toEqual(["src/app/New.tsx:1  no-new-comments", "src/app/New.tsx:2  no-new-effects"])
  expect(elsewhere.out).not.toContain("Use the loader.")
})

test("a rules file that turns off a rule nobody has, names a file group nobody defines, or cannot be read blocks with the file's path", async () => {
  const { run, share, root } = scene()
  await run(["rules", "--init"])
  const committed = join(root, ".grisha", "rules.json")
  share({ rules: [{ name: "no-new-comment", off: true }, { name: "no-act", pattern: "\\bact\\(", files: "specs", fix: "Wait." }] })
  const typo = await run(["gate"])
  expect(typo.code).toBe(1)
  expect(typo.out).toContain(`${committed}: rules[0] "no-new-comment" turns off a rule that no earlier file has.`)
  expect(typo.out).toContain(`${committed}: rules[1] "no-act" applies to the file group "specs", which no rules file defines under "files".`)

  share("{")
  const broken = await run(["rules"])
  expect(broken.code).toBe(1)
  expect(broken.out).toContain(`${committed} is not valid JSON`)
})

test("a repository says once which files are its tests, and every rule for tests follows", async () => {
  const { run, put, share } = scene()
  await run(["rules", "--init"])
  put("checks/inbox.ts", 'spyOn(store, "save")\nawait Bun.sleep(50)\n')
  put("src/inbox.test.ts", 'spyOn(store, "save")\n')
  const before = await run(["rules"])
  expect(lines(before.out).filter((line) => /^\S+:\d+  /.test(line))).toEqual(["src/inbox.test.ts:1  no-spies"])
  expect(before.out).toContain("  tests  **/*.test.*  **/*.spec.*")

  share({ files: { tests: ["checks/**"] } })
  const after = await run(["rules"])
  expect(lines(after.out).filter((line) => /^\S+:\d+  /.test(line)).sort()).toEqual(["checks/inbox.ts:1  no-spies", "checks/inbox.ts:2  no-sleeps-in-tests"])
  expect(after.out).toContain("  tests  checks/**")
})

test("a change to your rules blocks until you approve it, once for every repository", async () => {
  const { run, home } = scene()
  const other = scene()
  await run(["rules", "--init"])
  const yours = join(home, "rules.json")
  const starter = readFileSync(yours, "utf8")
  expect((await run(["gate"])).code).toBe(0)

  const edited = JSON.parse(starter)
  edited.rules = edited.rules.filter((rule: { name: string }) => rule.name !== "no-spies")
  edited.rules[0].pattern = "^//"
  edited.rules.push({ name: "no-act", pattern: "\\bact\\(", files: "tests", fix: "Wait for what the user sees." })
  writeFileSync(yours, JSON.stringify(edited))
  const gated = await run(["gate"])
  expect(gated.code).toBe(1)
  expect(gated.out).toContain("The rules here are not the ones the person approved:")
  expect(gated.out).toContain("no longer in force: no-spies")
  expect(gated.out).toContain("new: no-act")
  expect(gated.out).toContain("changed: no-new-comments")
  expect(gated.out).toContain("  →  ^//")
  expect((await other.run(["gate"], { home })).code).toBe(1)

  expect((await run(["rules", "--approve"], { ask: null })).out).toContain("Nobody was asked")
  const forAHost = await run(["gate", "--for", "grisha rules --approve"])
  expect(forAHost.code).toBe(2)
  expect(forAHost.out).toContain("no longer in force: no-spies")
  const inTheApp = JSON.parse((await run(["hook"], { input: () => JSON.stringify({ tool_name: "Bash", tool_input: { command: "grisha rules --approve" } }) })).out).hookSpecificOutput
  expect(inTheApp.permissionDecision).toBe("ask")
  expect(inTheApp.permissionDecisionReason).toContain("new: no-act")
  const asked: string[] = []
  await run(["rules", "--approve"], { ask: async (shown) => (asked.push(shown), "yes") })
  expect(asked.join()).toContain("no longer in force: no-spies")
  expect((await run(["gate"])).code).toBe(0)
  expect((await other.run(["gate"], { home })).code).toBe(0)

  unlinkSync(yours)
  expect((await run(["gate"])).out).toContain("no longer in force: no-new-comments")
  expect((await run(["rules", "--init"])).out).toContain("the copy you approved is at")

  writeFileSync(yours, JSON.stringify(edited, null, 2))
  mkdirSync(dirname(join((await run(["home"])).out, "rules.json")), { recursive: true })
  writeFileSync(join((await run(["home"])).out, "rules.json"), JSON.stringify({ rules: [{ name: "no-act", off: true }] }))
  expect((await run(["gate"])).out).toContain("no longer in force: no-act")
  expect((await other.run(["gate"], { home })).code).toBe(0)
})

test("a branch cannot loosen the repository's committed rules for itself", async () => {
  const { run, put, share, git } = scene()
  await run(["rules", "--init"])
  share({ rules: [{ name: "no-act", pattern: "\\bact\\(", files: "tests", fix: "Wait for what the user sees." }] })
  git("checkout", "-q", "-b", "work")
  put("src/app/New.test.tsx", "act(() => {})\n")
  put(".grisha/rules.json", JSON.stringify({ rules: [] }))
  const edited = await run(["rules"])
  expect(edited.out).toContain("src/app/New.test.tsx:1  no-act")
  expect(edited.out).toContain("waits to be merged")
  git("add", ".grisha")
  git("commit", "-q", "-m", "loosen")
  expect((await run(["gate"])).out).toContain("src/app/New.test.tsx:1  no-act")

  git("checkout", "-q", "main")
  git("merge", "-q", "work")
  expect((await run(["gate"])).code).toBe(0)
})

test("the agent asks, the person answers in their agent app, and the yes covers only what they were shown", async () => {
  const { run, plan, sheetPath } = scene()
  await plan()
  const hook = async (command: string) =>
    JSON.parse((await run(["hook"], { input: () => JSON.stringify({ tool_name: "Bash", tool_input: { command, timeout: 5 } }) })).out).hookSpecificOutput
  const asked = await hook("grisha approve")
  expect(asked.permissionDecision).toBe("ask")
  expect(asked.permissionDecisionReason).toContain("counts-unread: the count is the number of unread rows")
  expect(asked.updatedInput.timeout).toBe(5)
  const mark = /^export GRISHA_APPROVED=(\w+); grisha approve$/.exec(asked.updatedInput.command)?.[1] ?? "no mark"

  expect((await run(["approve"], { ask: null, approved: "1" })).out).toContain("not what the person was asked")
  writeFileSync(sheetPath(), JSON.stringify({ ...SHEET, task: "Count unread and starred rows" }))
  expect((await run(["approve"], { ask: null, approved: mark })).out).toContain("not what the person was asked")
  expect((await run(["show"])).out).toContain("plan not approved")

  writeFileSync(sheetPath(), JSON.stringify(SHEET))
  expect((await run(["approve"], { ask: null, approved: mark })).out).toContain("The person approved the plan.")
  const again = await hook("grisha approve")
  expect(again.permissionDecision).toBe("deny")
  expect(again.permissionDecisionReason).toContain("already approved")

  const forAHost = await run(["gate", "--for", "grisha approve"])
  expect(forAHost.code).toBe(1)
})

test("a command that starts by entering another checkout is judged in that checkout", async () => {
  const here = scene()
  const other = scene()
  await other.plan()
  await other.run(["approve"])
  await other.run(["run"])
  const asked = (command: string) => here.run(["hook", "--before", "git commit"], { home: other.home, input: () => JSON.stringify({ tool_name: "Bash", tool_input: { command } }) })
  expect((await asked(`cd ${other.root} && git commit -m wip`)).out).toContain("counts-unread is failing.")
  expect((await asked(`cd "${other.root}"; git commit -m wip`)).out).toContain("counts-unread is failing.")
  expect((await asked("git commit -m wip")).out).toBe("")
})

test("in a terminal, only a typed yes approves", async () => {
  const { run, plan } = scene()
  await plan()
  const questions: string[] = []
  expect((await run(["approve"], { ask: async (question) => (questions.push(question), " YES\n") })).out).toContain("The person approved the plan.")
  expect(questions.join()).toContain("counts-unread")
  expect(questions.join()).toContain("Type yes")
})

test("a base that does not exist, or a git command that fails, is reported and never read as a result", async () => {
  const { run, plan, put, root } = scene()
  const typo = await run(["gate", "--base", "mian"])
  expect(typo.code).toBe(1)
  expect(typo.out).toContain('No branch or commit called "mian"')

  await plan()
  put("src/other/new.ts", "export const two = 2\n")
  const real = realIO(root).git
  const broken = await run(["outside"], { git: (args) => (args[0] === "diff" ? { code: 128, out: "fatal: bad object" } : real(args)) })
  expect(broken.code).toBe(1)
  expect(broken.out).toContain("git diff --name-only")
  expect(broken.out).toContain("fatal: bad object")
  expect(broken.out).not.toContain("Changed, but in no planned box")
})

test("a hook that cannot read its input, or cannot ask git, refuses the command", async () => {
  const { run, root } = scene()
  for (const input of ["not json", "", "\n"]) {
    const answered = await run(["hook"], { input: () => input })
    expect(answered.code).toBe(0)
    expect(JSON.parse(answered.out).hookSpecificOutput.permissionDecision).toBe("deny")
  }
  await run(["rules", "--init"])
  const real = realIO(root).git
  const commit = () => JSON.stringify({ tool_name: "Bash", tool_input: { command: "git commit -m wip" } })
  const noGit = await run(["hook", "--before", "git commit"], { input: commit, git: (args) => (args[0] === "diff" ? { code: 128, out: "fatal: index file corrupt" } : real(args)) })
  expect(JSON.parse(noGit.out).hookSpecificOutput.permissionDecisionReason).toContain("index file corrupt")
  expect((await run(["hook"], { input: () => JSON.stringify({ tool_name: "Read", tool_input: { file_path: "a" } }) })).out).toBe("")
})

test("a refusal at the gate is logged once, however often the gate is asked", async () => {
  const { run, put } = scene()
  await run(["rules", "--init"])
  put("src/app/New.tsx", "useEffect(() => {})\n")
  const log = join((await run(["home"])).out, "catches.jsonl")
  await run(["gate"])
  await run(["gate"])
  expect(lines(readFileSync(log, "utf8")).map((line) => JSON.parse(line).rule)).toEqual(["no-new-effects"])
})

test("the gate refuses what is known wrong, and with --proven also what has not been shown yet", async () => {
  const { run, plan, put } = scene()
  await plan()
  expect((await run(["gate"])).out).toContain("The plan is not approved.")
  await run(["approve"])
  expect((await run(["gate"])).code).toBe(0)
  expect((await run(["gate", "--proven"])).out).toContain("counts-unread is not run.")

  await run(["run"])
  expect((await run(["gate"])).out).toContain("counts-unread is failing.")
  put("src/inbox/count.sh", "echo 2\n")
  await run(["run"])
  expect((await run(["gate", "--proven"])).code).toBe(0)
})

test("the hook refuses only the commands the person named, each at the bar they named", async () => {
  const { run, plan, put } = scene()
  await plan()
  await run(["approve"])
  const asked = (command: string, ...flags: string[]) => run(["hook", ...flags], { input: () => JSON.stringify({ tool_name: "Bash", tool_input: { command } }) })
  const wired = ["--before", "git commit", "--proven-before", "git push", "--proven-before", "gh pr create"]

  expect((await asked("git commit -m wip", ...wired)).out).toBe("")
  expect((await asked("git push", ...wired)).out).toContain("counts-unread is not run.")
  expect((await asked("gh  pr create --fill", ...wired)).out).toContain("counts-unread is not run.")
  expect((await asked("git push")).out).toBe("")

  await run(["run"])
  expect((await asked("git commit -m wip", ...wired)).out).toContain("counts-unread is failing.")
  expect((await asked("git commit -m wip")).out).toBe("")
  expect((await asked("git commit-tree abc", ...wired)).out).toBe("")
  expect((await asked("git status", ...wired)).out).toBe("")
  expect((await asked("jj commit -m wip", "--before", "jj commit")).out).toContain("counts-unread is failing.")
  expect((await asked("grisha approve")).out).toContain('"permissionDecision":"deny"')

  put("src/inbox/count.sh", "echo 2\n")
  await run(["run"])
  expect((await asked("git push", ...wired)).out).toBe("")
})

test("next names the one thing to do now, from an empty checkout to nothing left", async () => {
  const { run, put } = scene()
  const next = async () => run(["next"])
  expect(await next()).toEqual({ code: 1, out: 'No task is started in this checkout. Begin with: grisha start "<task>"' })

  const started = (await run(["start", SHEET.task])).out
  const sheet = started.split("\n")[0]?.replace(/^[^:]*: /, "") ?? ""
  expect(started).toContain('"kind": "change"')
  expect((await next()).out).toContain(`Next: The sheet has no units, so nothing is claimed. Write the plan into ${sheet}.`)

  writeFileSync(sheet, JSON.stringify({ ...SHEET, units: "soon" }))
  const broken = await next()
  expect(broken.out).toContain('- "units" must be a list of build steps, in order.')
  expect(broken.out).toContain("`grisha help sheet` shows the shape.")

  writeFileSync(sheet, JSON.stringify(SHEET))
  expect((await next()).out).toContain("Next: The plan is not approved. Run `grisha approve`")
  expect((await run(["run"])).out).toBe("Nothing is run before the plan is approved. Next: The plan is not approved. Run `grisha approve`: the person is shown the plan and asked.")
  expect((await run(["approve"])).out).toBe("The person approved the plan.\nNext: counts-unread is not run. Run `grisha run counts-unread`. A check for new behaviour has to fail before the change is made.")

  const failing = (await run(["run", "counts-unread"])).out.split("\n").at(-1) ?? ""
  const evidence = /Its output is at (\S+)\. Make the code do what the claim says, then run `grisha run counts-unread`\./.exec(failing)?.[1] ?? "no path"
  expect(readFileSync(evidence, "utf8")).toBe("")
  const stuck = await next()
  expect(stuck.code).toBe(1)
  expect(stuck.out).toContain("plan approved · 1 unit · 2 claims: 1 failing, 1 for you to read")
  expect(stuck.out.endsWith("Then run `grisha next` again.")).toBe(true)

  put("src/inbox/count.sh", "echo 2\n")
  put("src/other/unrelated.ts", "export const one = 2\n")
  expect((await run(["run"])).out).toContain("Nothing is left: every claim with a check is proven and no rule is broken.")
  const done = await next()
  expect(done.code).toBe(0)
  expect(done.out).toContain("`grisha pr` prints the proof for the pull request.")
  expect(done.out).toContain("Left for the person to read: reads-well, the query is easy to follow.")
  expect(done.out).toContain("1 changed file is in no planned box: `grisha outside` lists it.")
})

test("checks that can be run in one go are asked for in one step, and a failing claim comes before a stale one", async () => {
  const { run, plan, put } = scene()
  const [unit] = SHEET.units
  const two = { ...unit, claims: [{ id: "still-a-number", says: "the count is a number", role: "keeps", check: { how: "script", run: "true" } }, ...(unit?.claims ?? [])] }
  await plan({ ...SHEET, units: [two] })
  await run(["approve"])
  expect((await run(["next"])).out).toContain("Next: still-a-number, counts-unread are not run. Run `grisha run still-a-number counts-unread`.")

  await run(["run"])
  put("src/inbox/count.sh", "echo 5\n")
  expect((await run(["show"])).out).toContain("the count is a number    [stale]")
  expect((await run(["next"])).out).toContain("Next: counts-unread is failing.")
})

test("the command explains itself: every status, the sheet and the rules, with examples it accepts", async () => {
  const { run, home } = scene()
  const help = (await run(["help"])).out
  for (const status of ["no check", "for you to read", "not run", "failing", "stale", "passes, never seen failing", "proven"]) expect(help).toContain(`\n  ${status}  `)
  expect((await run([])).out).toBe(help)
  expect((await run(["help", "hooks"])).out).toContain("grisha hook --before 'git commit' --proven-before 'git push'")
  expect((await run(["help", "nonsense"])).out).toContain("Topics: sheet, rules, hooks.")
  const example = (text: string) => /^\{\n[\s\S]*?^\}$/m.exec(text)?.[0] ?? ""

  const sheet = (await run(["start", "Try the example"])).out.split("\n")[0]?.replace(/^[^:]*: /, "") ?? ""
  writeFileSync(sheet, example((await run(["help", "sheet"])).out))
  expect((await run(["show"])).out).toContain("other-tenants: another tenant's rows never count    [no check]")

  writeFileSync(join(home, "rules.json"), example((await run(["help", "rules"])).out))
  const rules = (await run(["rules"])).out
  expect(rules).toContain("new: no-new-comments, no-spies")
})

test("any host can pass the command about to run and get the same answer in plain text", async () => {
  const { run, plan } = scene()
  await plan()
  await run(["approve"])
  await run(["run"])
  const approval = await run(["gate", "--for", "grisha approve"])
  expect(approval.code).toBe(1)
  expect(approval.out).toContain("already approved")
  const commit = await run(["gate", "--for", "git commit -m wip", "--before", "git commit"])
  expect(commit.code).toBe(1)
  expect(commit.out).toContain("counts-unread is failing.")
  expect(await run(["gate", "--for", "git commit -m wip"])).toEqual({ code: 0, out: "" })
  expect(await run(["gate", "--for", "git status", "--before", "git commit"])).toEqual({ code: 0, out: "" })

  const nowhere = scene(temp("no-repo"))
  expect((await nowhere.run(["gate", "--for", "git commit -m wip", "--before", "git commit"])).code).toBe(0)
})

test("the pull request section lists each claim, what is left to read and what fell outside the plan", async () => {
  const { run, plan, put } = scene()
  await plan()
  put("src/other/unrelated.ts", "export const one = 2\n")
  const section = (await run(["pr"])).out
  expect(section).toContain("the count is the number of unread rows: **not run**, by script: sh test/inbox.test.sh")
  expect(section).toContain("## Left for a person to read\n\n- the query is easy to follow")
  expect(section).toContain("## Changed outside the planned modules\n\n- `src/other/unrelated.ts`")
})

test("a second worktree shares the repository's sheets but keeps its own current task", async () => {
  const first = scene()
  await first.plan()
  const other = `${first.root}-wt`
  first.git("worktree", "add", "-q", other, "-b", "second")
  const second = scene(realpathSync(other))
  expect(basename((await second.run(["home"])).out)).toBe(basename((await first.run(["home"])).out))
  expect((await second.run(["show"])).out).toContain("No task is started in this checkout")
})

test("an added line that starts with ++ is not read as the start of another file", async () => {
  const { run, put, git } = scene()
  put("src/app/Old.tsx", "const total = 1\n")
  git("add", ".")
  git("commit", "-q", "-m", "old code")
  await run(["rules", "--init"])
  put("src/app/Old.tsx", "const total = 1\n++ total\nuseEffect(() => {})\n")
  expect((await run(["rules"])).out).toContain("src/app/Old.tsx:3  no-new-effects")
})

test("the map draws each box with where its claims stand", async () => {
  const { run, plan } = scene()
  await plan({ ...SHEET, boxes: [{ ...SHEET.boxes[0], calls: ["store"] }, { name: "store", paths: ["src/store"] }] })
  const map = (await run(["show", "--mermaid"])).out
  expect(map).toContain('b0["inbox<br/>1 not run, 1 for you to read"]')
  expect(map).toContain('b1["store<br/>not touched"]')
  expect(map).toContain("b0 --> b1")
})

function port() {
  const theirs = scene()
  const ours = scene()
  const sum = (text: string) => createHash("sha256").update(text).digest("hex")
  const publish = (message: string) => {
    theirs.git("add", "-A")
    theirs.git("commit", "-q", "-m", message)
    return theirs.git("rev-parse", "HEAD").stdout.toString().trim()
  }
  theirs.put("pstack/skills/demo/SKILL.md", "one\n")
  theirs.put("pstack/skills/demo/guide.md", "two\n")
  theirs.put("pstack/skills/demo/steady.md", "three\n")
  theirs.put("pstack/skills/not-ported/SKILL.md", "four\n")
  const sources = { "skills/demo/SKILL.md": sum("one\n"), "skills/demo/guide.md": sum("two\n"), "skills/demo/steady.md": sum("three\n") }
  ours.put("skills/demo/UPSTREAM.json", JSON.stringify({ repository: theirs.root, folder: "pstack", commit: publish("skills"), sources, skipped: ["skills/demo/corpus"] }))
  const check = () => {
    const printed: string[] = []
    const world = realIO(ours.root)
    return { code: upstream({ ...world, print: (text) => printed.push(text) }), out: printed.join("\n") }
  }
  return { theirs, publish, check }
}

test("the upstream check is quiet while upstream still has the files that were ported", () => {
  const { theirs, publish, check } = port()
  theirs.put("pstack/skills/not-ported/SKILL.md", "four, changed\n")
  theirs.put("pstack/skills/demo/corpus/case.md", "left out on purpose\n")
  const head = publish("unrelated")
  expect(check()).toEqual({ code: 0, out: `${theirs.root} is at ${head.slice(0, 7)}\nNo ported file changed upstream.` })
})

test("the upstream check lists each ported file that changed, went or appeared upstream", () => {
  const { theirs, publish, check } = port()
  const taken = theirs.git("rev-parse", "HEAD").stdout.toString().trim().slice(0, 7)
  theirs.put("pstack/skills/demo/SKILL.md", "one, changed\n")
  theirs.git("rm", "-q", "pstack/skills/demo/guide.md")
  theirs.put("pstack/skills/demo/added.md", "five\n")
  publish("moved on")
  const { code, out } = check()
  expect(code).toBe(1)
  expect(lines(out).slice(1, 5)).toEqual([
    `demo, taken at ${taken}`,
    "  changed upstream  skills/demo/SKILL.md",
    "  gone upstream     skills/demo/guide.md",
    "  new upstream      skills/demo/added.md",
  ])
  expect(out).not.toContain("steady.md")
})

test("every starter rule catches the line it is for and lets the line beside it through", async () => {
  const { run, put } = scene()
  const rows: [string, string, string?][] = [
    ["src/app/View.tsx", "// explains itself", "no-new-comments"],
    ["src/app/View.tsx", "// @ts-expect-error upstream type", "no-new-suppressions"],
    ["src/app/View.tsx", "useEffect(() => load(), [])", "no-new-effects"],
    ["src/app/View.tsx", "const effects = useEffects"],
    ["src/app/View.tsx", "setInterval(tick, 1000)", "no-new-timers"],
    ["src/app/host.ts", "timers.setTimeout(tick, 1000)"],
    ["src/app/host.ts", "const now = options.now ?? Date.now", "no-optional-clock"],
    ["src/app/host.ts", "type Options = { now?: () => number }", "no-optional-clock"],
    ["src/app/host.ts", "type Options = { now: () => number }"],
    ["src/app/host.ts", "const known = now ? early : late"],
    ["src/app/host.ts", 'if (error.message.includes("not found")) return null', "no-reading-error-text"],
    ["src/app/host.ts", "if (/timeout/.test(err?.message)) retry()", "no-reading-error-text"],
    ["src/app/host.ts", 'if (commit.message.includes("fixup")) squash()'],
    ["src/app/host.ts", 'if (error.code === "not_found") return null'],
    ["src/app/host.test.ts", 'test.only("renames", () => {})', "no-skipped-tests"],
    ["src/app/host.test.ts", 'mock.module("./store", () => fake)', "no-module-mocks"],
    ["src/app/host.test.ts", 'spyOn(store, "save")', "no-spies"],
    ["src/app/host.test.ts", "const save = mock(() => {})", "no-spies"],
    ["src/app/host.test.ts", "expect(save).toHaveBeenCalledWith(row)", "no-spies"],
    ["src/app/host.test.ts", "expect(sent).toHaveLength(1)"],
    ["src/app/host.test.ts", "jest.useFakeTimers()", "no-fake-timers"],
    ["src/app/host.test.ts", "globalThis.fetch = fake", "no-fake-timers"],
    ["src/app/host.test.ts", "expect(globalThis.fetch === real).toBe(true)"],
    ["src/app/host.test.ts", "const before = Date.now()", "no-wall-clock-in-tests"],
    ["src/app/host.test.ts", "const started = new Date()", "no-wall-clock-in-tests"],
    ["src/app/host.test.ts", 'const started = new Date("2026-11-17T12:00:00Z")'],
    ["src/app/host.test.ts", "await Bun.sleep(50)", "no-sleeps-in-tests"],
    ["src/app/host.test.ts", "await new Promise((done) => setTimeout(done, 50))", "no-sleeps-in-tests"],
    ["src/app/host.test.ts", "timers.setTimeout(tick, 1000)"],
    ["src/app/host.test.ts", "await clock.advance(HOUR)"],
    ["src/app/host.test.ts", "const user = { id: 1 } as unknown as User", "no-casts-in-tests"],
    ["src/app/host.test.ts", "const user = buildUser({ id: 1 })"],
    ["src/app/host.test.ts", "await sql`delete from users`.execute(db)", "no-sql-in-tests"],
    ["src/app/host.test.ts", 'await db.deleteFrom("users").execute()'],
    ["src/app/host.test.ts", 'await db.execute("set local role authenticated")', "no-hand-set-role"],
  ]
  await run(["rules", "--init"])
  const files = Map.groupBy(rows, ([file]) => file)
  for (const [file, inFile] of files) put(file, inFile.map(([, text]) => text).join("\n"))
  const caught = lines((await run(["rules"])).out).filter((line) => /^\S+:\d+  /.test(line))
  const expected = [...files].flatMap(([file, inFile]) => inFile.flatMap(([, , rule], index) => (rule ? [`${file}:${index + 1}  ${rule}`] : [])))
  expect(caught.sort()).toEqual(expected.sort())
  const starter: { name: string }[] = JSON.parse(readFileSync(join(import.meta.dir, "..", "rules", "starter.json"), "utf8")).rules
  expect(starter.map((rule) => rule.name).filter((name) => !rows.some(([, , rule]) => rule === name))).toEqual([])
})

test("every output the README quotes is what the command prints", async () => {
  const printed = await session(() => new Date("2026-11-18T12:00:00Z"))
  const readme = readFileSync(join(import.meta.dir, "..", "README.md"), "utf8")
  const quoted = [...readme.matchAll(/```(console|json)\n([\s\S]*?)\n```/g)].filter(([, kind, body = ""]) => kind === "console" || body.includes('"units"'))
  expect(quoted.length).toBeGreaterThan(8)
  const wrong = quoted.flatMap(([, , body = ""]) => {
    let from = 0
    return body.split(/^…$/m).flatMap((part) => {
      const piece = part.trim()
      const at = printed.indexOf(piece, from)
      if (at === -1) return [piece]
      from = at + piece.length
      return []
    })
  })
  expect(wrong).toEqual([])
})
