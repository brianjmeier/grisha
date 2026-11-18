# proofsheet

One sheet per task that says what must be true and how each claim is proven. An agent plans the work on the sheet, a person approves it before any code is written, and the `proofsheet` command, not the agent, decides where each claim stands.

It keeps everything outside the checkout, in `~/.proofsheet/`, so you can try it on a shared codebase without changing that codebase. The one file it reads from a checkout is an optional `.proofsheet/rules.json`, for rules a repository wants to share.

## Try it

```sh
bun install
bun link                 # puts `proofsheet` on your PATH
bash docs/demo.sh        # one task, start to pull request, in a throwaway repository
```

To give your agents the skills, link each folder in `skills/` into the folder your agent reads skills from:

```sh
for skill in skills/*/; do ln -s "$PWD/$skill" ~/.claude/skills/; done
```

## The loop

```text
1 claims     what must be true after, what must stay true elsewhere
2 map        boxes are the modules touched; units are the build steps, each with its claims
3 approve    the person, in their own terminal; nothing is run before this
4 build      one unit at a time: check fails, change, check passes, scope read, commit
5 hand over  gate, files outside the plan, pull request section
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

## Commands

```text
start "<task>"      begin a sheet for a task in this checkout, or pick it up again
show                the plan and where each claim stands (--json, --mermaid)
approve             the person approves the plan
run [claim ...]     run the checks and record what happened
outside             changed files that no planned box covers
rules               check the lines this branch adds against your rules and this repository's (--init, --approve)
gate                what blocks a commit (--final: a push or pull request; --for "<command>": that command)
pr                  the proof as a pull request section
home                where this repository's sheets and verification skills live
```

## Rules

`proofsheet rules --init` writes a starter `rules.json` for every repository you work in: no new comments, effects, timers, lint suppressions, optional clocks or errors read by their wording, and in tests no skips, mocks, spies, fake timers, real clock, sleeps, casts, SQL or hand-set database role. Each rule is a pattern, the files it applies to and the fix to name.

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

Rules are read from three files, in this order. A later file adds rules and file groups, replaces one of the same name, or turns a rule off as above:

| Covers | File |
|---|---|
| Every repository | `~/.proofsheet/rules.json` |
| This repository, committed for everyone who works on it | `.proofsheet/rules.json`, as it is on the base branch |
| This repository, only you | `~/.proofsheet/repos/<repository>/rules.json` |

`proofsheet rules` prints the three paths and each file group for the checkout you are in.

A change to the rules does not take effect quietly. When either of your two files changes, every commit is blocked and the gate lists what is new, changed or no longer in force, until you run `proofsheet rules --approve` in your own terminal. The committed file is read from the base branch, so a branch's edit to it changes nothing until it is merged, and the pull request is its review. Rules look only at lines the branch adds, so existing code never fails and nobody is asked to clean up a colleague's file. Every catch is logged once to `catches.jsonl`, which is your record of what the rules actually stop.

## Skills

| Skill | Use |
|---|---|
| `proofsheet` | The loop above. |
| `create-verification-skill`, `maintain-verification-skill` | Give a repository a scripted way to drive the real app, and keep it honest. |
| `create-formal-verification-skill`, `maintain-formal-verification-skill`, `statechart` | Check a property in every case with a model checker or prover, and show the result as a chart. |
| `blast-radius` | Find what a change could break elsewhere, and prove the one fact it is safe because of. |
| `no-comments` | Remove comments from a diff and turn the constraints they claim into code. |

All but the first come from [pstack](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan (MIT, see `skills/PSTACK-LICENSE`). Each folder's `UPSTREAM.json` records the commit, a checksum of every source file and what was changed. `bun run upstream` lists the ported files that have changed upstream since.

`statechart` installs Java and TLC through mise on its first run. To use a Java you already have, set `JAVA` and `TLA2TOOLS`.

## Hosts and views

Proofsheet does not depend on any agent app. An app, or a git hook, passes the command an agent is about to run to `proofsheet gate --for "<command>"` and refuses it on exit 1. [docs/hosts.md](docs/hosts.md) has the wiring for git hooks, Claude Code and other apps, how approval stays with the person, and how a view draws the sheet.

## Development

```sh
bun test        # runs the command against real git repositories in temp folders
bun run check   # types
```

## Licence

MIT, see [LICENSE](LICENSE). The skills ported from pstack are © Lauren Tan, also MIT, see [skills/PSTACK-LICENSE](skills/PSTACK-LICENSE).
