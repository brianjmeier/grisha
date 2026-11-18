# grisha

A coding agent says "done, tests pass". Grisha makes it show that.

For each task the agent writes a sheet: the claims that must be true when the work is finished, and the command that checks each one. You approve the sheet before any code is written. After that the `grisha` command runs the checks itself and says where each claim stands, so the agent cannot mark its own work.

## One task

A badge counts every row and should count only unread ones. The agent writes its plan on a sheet, and this is how the plan reads back:

```console
$ grisha show
Count only unread rows
plan not approved · 1 unit · 3 claims: 2 not run, 1 no check

1 change  count unread rows    touches inbox/count
    proves  counts-unread: the badge shows the number of unread rows    [not run]
            by script: sh test/unread.test.sh
    keeps   still-a-number: the badge still shows a number    [not run]
            by script: sh test/number.test.sh
    keeps   other-tenants: another tenant's rows never count    [no check]
            by nothing yet
```

The agent cannot approve its own plan:

```console
$ grisha approve
The person approves it by running `grisha approve` in their own terminal.
(exit 1)
```

You run the same command in your own terminal. It shows you the plan and asks:

```console
Approve this? Type yes: yes
Approved. Build one unit at a time: run its checks, see them fail, make the change, run them again.
```

A check for new behaviour has to fail before it can prove anything. The agent runs the checks, makes the change, and runs them again:

```console
$ grisha run
counts-unread: failed (exit 1)    ~/.grisha/repos/shop/tasks/count-only-unread-rows/evidence/counts-unread-1.txt
…
    proves  counts-unread: the badge shows the number of unread rows    [failing]
…
$ grisha run counts-unread
counts-unread: passed    ~/.grisha/repos/shop/tasks/count-only-unread-rows/evidence/counts-unread-2.txt
…
    proves  counts-unread: the badge shows the number of unread rows    [proven]
```

One claim still has no check, so the push is refused:

```console
$ grisha gate --final
Before this goes further:
- other-tenants has no check. Give it one, or set its check to { "how": "person reads" }.
(exit 1)
```

The rest of this page quotes the same task. `bun run session` prints all of it, from the first command to the pull request section.

## Install

Grisha needs [Bun](https://bun.sh).

```sh
git clone https://github.com/brianjmeier/grisha && cd grisha
bun install
bun link                   # puts `grisha` on your PATH
grisha rules --init    # writes your starter rules
```

Give your agents the skills by linking each folder in `skills/` into the folder your agent reads skills from:

```sh
for skill in skills/*/; do ln -s "$PWD/$skill" ~/.claude/skills/; done
```

Sheets, rules and results live in `~/.grisha/`, outside your checkouts, so you can use it on a shared codebase without changing that codebase.

### Make it refuse

Nothing is refused until something asks the gate before a commit or a push. Two git hook files do that for every agent app. `git rev-parse --git-path hooks` prints the folder to put them in:

```sh
# pre-commit
exec grisha gate

# pre-push
exec grisha gate --final
```

An agent can skip git hooks with `--no-verify`. In Claude Code, a hook in `settings.json` cannot be skipped, and it also refuses the agent's own attempts to approve:

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "grisha hook || exit 2" }] }]
  }
}
```

[docs/hosts.md](docs/hosts.md) covers other apps, how approval stays with you, and how a view draws the sheet.

## The loop

```text
1 claims     agent   grisha start "<task>", then what must be true after and what must stay true
2 map        agent   boxes are the modules touched; units are the build steps, each with its claims
3 approve    you     grisha approve, in your own terminal; nothing is run before this
4 build      agent   one unit at a time: its check fails, the change, its check passes, commit
5 hand over  agent   grisha gate --final, grisha outside, grisha pr
```

## What a claim's status means

| Status | Meaning |
|---|---|
| `no check` | Nobody has decided how to settle it. Blocks a push. |
| `for you to read` | Left to a person on purpose. Never counted as proven. |
| `not run` | Has a check that was never run. Blocks a push. |
| `failing` | Its last run failed. Blocks a commit. |
| `stale` | It passed, then a file in the boxes it covers changed. Blocks a commit. |
| `passes, never seen failing` | It passes, but has not shown it can fail. Blocks a push. |
| `proven` | Its check failed once, passes now, and its code has not changed since. |

Status is worked out on every call from the recorded runs and the files as they are. Nothing stores it, so it cannot go out of date. Only runs of the command a claim has now count, so changing a check's command starts it again at `not run`.

In the task above, changing the code made the other check stale, so the commit was refused. Run again it passed, but it had passed before the change too and had never shown it could fail. The agent broke the code on purpose, ran the check, restored the code and ran it once more:

```console
$ grisha gate
Before this goes further:
- still-a-number is stale. Run `grisha run still-a-number`.
(exit 1)
…
    keeps   still-a-number: the badge still shows a number    [passes, never seen failing]
…
still-a-number: failed (exit 1)    ~/.grisha/repos/shop/tasks/count-only-unread-rows/evidence/still-a-number-3.txt
…
still-a-number: passed    ~/.grisha/repos/shop/tasks/count-only-unread-rows/evidence/still-a-number-4.txt
…
    keeps   still-a-number: the badge still shows a number    [proven]
```

## Commands

```text
start "<task>"      begin a sheet for a task in this checkout, or pick it up again
show                the plan and where each claim stands (--json, --mermaid)
approve             the person approves the plan
run [claim ...]     run the checks and record what happened
outside             changed files that no planned box covers
rules               check the lines this branch adds against your rules and this repository's (--init, --approve)
gate                what blocks a commit (--final: a push or pull request; --for "<command>": that command)
hook                gate --for as a Claude Code hook: reads the hook's JSON, answers in its shape
pr                  the proof as a pull request section
home                where this repository's sheets and verification skills live

--base <ref>        compare against this branch instead of the default one, for a branch stacked on another
```

`start` prints the path of the sheet. This is the one the agent wrote for the task above:

```json
{
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
}
```

A unit's kind is `pin` (record today's behaviour in a test before anything moves), `reshape` (move code while the pin keeps passing) or `change`. A check's `how` is `script`, `test`, `drive app`, `model` or `person reads`.

`outside` names what changed without being planned, and `pr` prints the proof for the pull request body:

```console
$ grisha outside
Changed, but in no planned box:
  src/billing.ts
…
$ grisha pr
## How this was proven

1. **count unread rows** (change)
   - the badge shows the number of unread rows: **proven**, by script: sh test/unread.test.sh
   - the badge still shows a number: **proven**, by script: sh test/number.test.sh
   - another tenant's rows never count: **no check**, by nothing yet

## Changed outside the planned modules

- `src/billing.ts`
```

## Rules

A rule is a pattern, the files it applies to and the fix to name. Rules look only at lines the branch adds, so existing code never fails and nobody is asked to clean up a colleague's file. In the task above the agent left a comment in a new file:

```console
$ grisha rules
src/billing.ts:1  no-new-comments
  + // TODO: bill unread rows only
  Delete the comment. If it explains a workaround, fix what it works around; if it states a constraint, turn the constraint into a type, a test or a check.
```

The starter set from `grisha rules --init`: no new comments, effects, timers, lint suppressions, optional clocks or errors read by their wording, and in tests no skips, mocks, spies, fake timers, real clock, sleeps, casts, SQL or hand-set database role. Every catch is logged once to `catches.jsonl`, which is your record of what the rules actually stop.

Rules are read from three files, in this order. A later file adds rules and file groups, replaces one of the same name, or turns a rule off:

| Covers | File |
|---|---|
| Every repository | `~/.grisha/rules.json` |
| This repository, committed for everyone who works on it | `.grisha/rules.json`, as it is on the base branch |
| This repository, only you | `~/.grisha/repos/<repository>/rules.json` |

A rule's `files` is a list of patterns, or the name of a file group. The starter set defines one group, `tests`, and nine rules apply to it. A repository whose tests live elsewhere says so once, and all nine follow:

```json
{
  "files": { "tests": ["**/*.test.ts", "e2e/**"] },
  "rules": [
    { "name": "no-act", "pattern": "\\bact\\(", "files": "tests", "fix": "Wait for what the user sees." },
    { "name": "no-casts-in-tests", "off": true }
  ]
}
```

A change to the rules does not take effect quietly. In the task above the agent turned the rule off for itself instead of deleting the comment:

```console
$ grisha gate
Before this goes further:
- The rules here are not the ones the person approved:
  no longer in force: no-new-comments
  The person approves them by running `grisha rules --approve` in their own terminal.
(exit 1)
```

That is what happens when either of your two files changes: every commit is blocked until you run `grisha rules --approve` in your own terminal. The committed file is read from the base branch, so a branch's edit to it changes nothing until it is merged, and the pull request is its review.

## Skills

| Skill | Use |
|---|---|
| `grisha` | The loop above. |
| `create-verification-skill`, `maintain-verification-skill` | Give a repository a scripted way to drive the real app, and keep it honest. |
| `create-formal-verification-skill`, `maintain-formal-verification-skill`, `statechart` | Check a property in every case with a model checker or prover, and show the result as a chart. |
| `blast-radius` | Find what a change could break elsewhere, and prove the one fact it is safe because of. |
| `no-comments` | Remove comments from a diff and turn the constraints they claim into code. |

All but the first come from [pstack](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan (MIT, see `skills/PSTACK-LICENSE`). Each folder's `UPSTREAM.json` records the commit, a checksum of every source file and what was changed. `bun run upstream` lists the ported files that have changed upstream since.

`statechart` installs Java and TLC through mise on its first run. To use a Java you already have, set `JAVA` and `TLA2TOOLS`.

## Development

```sh
bun test           # runs the command against real git repositories in temp folders
bun run check      # types
bun run session    # prints the task this page quotes
```

A test fails when an output quoted on this page is no longer what the command prints.

## Licence

MIT, see [LICENSE](LICENSE). The skills ported from pstack are © Lauren Tan, also MIT, see [skills/PSTACK-LICENSE](skills/PSTACK-LICENSE).
