# grisha

One place for your rules, and one loop your agent repeats until they are all met.

A coding agent says "done, tests pass". Grisha makes it show that. For each task the agent writes a sheet: the claims that must be true when the work is finished, and the command that checks each one. You approve the sheet before any code is written. From then on the agent asks `grisha next`, does the one thing it is told, and asks again. Grisha runs the checks itself, so the agent cannot mark its own work.

## One task

A badge counts every row and should count only unread ones. The agent writes its plan on a sheet and asks what is next:

```console
$ grisha next
Count only unread rows
plan not approved · 1 unit · 3 claims: 2 not run, 1 no check

Next: The plan is not approved. Run `grisha approve`: the person is shown the plan and asked.

Then run `grisha next` again.
(exit 1)
```

The agent runs `grisha approve`. Your agent app stops on that command and asks its usual allow-or-deny question, with the plan as the text:

```console
$ grisha approve
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

After your yes the command goes through. Your yes covers the plan you were shown, so if the sheet changes afterwards you are asked again.

```console
$ grisha approve
The person approved the plan.
Next: counts-unread, still-a-number are not run. Run `grisha run counts-unread still-a-number`. A check for new behaviour has to fail before the change is made.
```

Every answer ends with the next step. The agent runs the checks, makes the change, and runs them again:

```console
$ grisha run counts-unread still-a-number
counts-unread: failed (exit 1)    ~/.grisha/repos/shop/tasks/count-only-unread-rows/evidence/counts-unread-1.txt
still-a-number: passed    ~/.grisha/repos/shop/tasks/count-only-unread-rows/evidence/still-a-number-1.txt
…
Next: counts-unread is failing. Its output is at ~/.grisha/repos/shop/tasks/count-only-unread-rows/evidence/counts-unread-1.txt. Make the code do what the claim says, then run `grisha run counts-unread`.
…
$ grisha run counts-unread
counts-unread: passed    ~/.grisha/repos/shop/tasks/count-only-unread-rows/evidence/counts-unread-2.txt
…
Next: still-a-number is stale. Run `grisha run still-a-number`. Code it covers changed after it last passed.
```

The loop ends when nothing is left:

```console
$ grisha next
Count only unread rows
plan approved · 1 unit · 3 claims: 2 proven, 1 for you to read

Nothing is left: every claim with a check is proven and no rule is broken. `grisha pr` prints the proof for the pull request.
Left for the person to read: other-tenants, another tenant's rows never count.
1 changed file is in no planned box: `grisha outside` lists it. Say why each one changed in the pull request, or add a box that covers it to the sheet.
```

The rest of this page quotes the same task. From a clone, `bun run session` prints all of it, from the first command to the pull request section.

## Install

Grisha runs on [Bun](https://bun.sh), so that has to be installed first.

```sh
npm install -g github:brianjmeier/grisha    # puts `grisha` on your PATH
grisha rules --init                         # writes your starter rules
```

The same line updates it later. Give your agents the skills by linking each one into the folder your agent reads skills from:

```sh
for skill in "$(npm root -g)"/grisha/skills/*/; do ln -s "$skill" ~/.claude/skills/; done
```

Sheets, rules and results live in `~/.grisha/`, outside your checkouts, so you can use it on a shared codebase without changing that codebase.

### When it runs

That is yours to choose. `grisha gate` exits 1 while something is known to be wrong, and `grisha gate --proven` exits 1 until every claim is proven. Call them wherever you want work stopped. `grisha help hooks` prints the two usual places.

Git hooks work for every agent app. `git rev-parse --git-path hooks` prints the folder to put them in:

```sh
# pre-commit
exec grisha gate

# pre-push
exec grisha gate --proven
```

An agent can skip git hooks with `--no-verify`, and a git hook cannot ask you anything. In Claude Code, a hook in `settings.json` has no such flag, and it is what puts the plan in front of you when the agent runs `grisha approve`. You name the commands it stops:

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command",
      "command": "grisha hook --before 'git commit' --proven-before 'git push' --proven-before 'gh pr create' || exit 2" }] }]
  }
}
```

The hook looks for those words in the command as typed, so `git -C <folder> commit` is not `git commit`. Git hooks see every commit and push however it was typed, so use both when you want nothing to slip past.

Without the Claude Code hook, `grisha approve` works only in a terminal, where it shows you the plan and asks you to type yes.

[docs/hosts.md](docs/hosts.md) covers other apps, how approval stays with you, and how a view draws the sheet.

## Where a claim stands

| Status | Meaning | Refused by |
|---|---|---|
| `no check` | Nobody has said how to check it. | `gate --proven` |
| `for you to read` | Left to a person on purpose. Never counted as proven. | |
| `not run` | Its check has not been run. | `gate --proven` |
| `failing` | Its check failed the last time it ran. | `gate` |
| `stale` | It passed, then a file in the boxes it covers changed. | `gate` |
| `passes, never seen failing` | It passes, but has not shown it can fail. | `gate --proven` |
| `proven` | Its check failed once, passes now, and its code has not changed since. | |

Status is worked out on every call from the recorded runs and the files as they are. Nothing stores it, so it cannot go out of date. Only runs of the command a claim has now count, so changing a check's command starts it again at `not run`.

In the task above, changing the code made the other check stale, so the gate refused the commit. Run again it passed, but it had passed before the change too and had never shown it could fail. The agent broke the code on purpose, ran the check, restored the code and ran it once more:

```console
$ grisha gate
Before this goes further:
- still-a-number is stale. Run `grisha run still-a-number`. Code it covers changed after it last passed.
(exit 1)
…
Next: still-a-number passes but was never seen failing. Break the code it covers, run `grisha run still-a-number`, restore the code and run it again.
…
still-a-number: failed (exit 1)    ~/.grisha/repos/shop/tasks/count-only-unread-rows/evidence/still-a-number-3.txt
…
still-a-number: passed    ~/.grisha/repos/shop/tasks/count-only-unread-rows/evidence/still-a-number-4.txt
…
plan approved · 1 unit · 3 claims: 2 proven, 1 no check
```

## Commands

```text
next                the one thing to do now; exit 0 means nothing is left
start "<task>"      begin a sheet for a task in this checkout, or pick it up again
show                the plan and where each claim stands (--json, --mermaid)
approve             ask the person to approve the plan; nothing is run before their yes
run [claim ...]     run the checks and record what happened
rules [rule ...]    check the code against the rules, or list every line a rule matches (--init, --approve)
outside             changed files that no planned box covers
pr                  the proof as a pull request section
gate                exit 1 while something is known wrong (--proven: until every claim is proven)
hook                the gate as a Claude Code PreToolUse hook
home                where this repository's sheets and verification skills live
help [topic]        topics: sheet, rules, hooks

--base <ref>        compare against this branch instead of the default one, for a branch stacked on another
```

`start` prints the path of the sheet and the shape to write, which `grisha help sheet` prints again. This is the one the agent wrote for the task above:

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

Boxes are the modules the task touches, and units are the build steps in order. A unit's kind is `pin` (record today's behaviour in a test before anything moves), `reshape` (move code while the pin keeps passing) or `change`. A check's `how` is `script`, `test`, `drive app`, `model` or `person reads`.

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
   - another tenant's rows never count: **for you to read**, by person reads

## Left for a person to read

- another tenant's rows never count

## Changed outside the planned modules

- `src/billing.ts`
```

## Rules

A rule is a pattern, the files it applies to and the fix to name. Unless you say otherwise, a rule blocks only the lines the branch adds, so existing code never fails and nobody is asked to clean up a colleague's file. In the task above the agent left a comment in a new file. The repository already had one comment, which is counted and not blocked:

```console
$ grisha rules
src/billing.ts:1  no-comments
  + // TODO: bill unread rows only
  Delete the comment. If it explains a workaround, fix what it works around; if it states a constraint, turn the constraint into a type, a test or a check.

Each rule, the lines it blocks, and the lines already in the code that match it:
  no-comments             added lines  1 line in 1 file
  no-effects              added lines  none
…
`grisha rules <rule>` lists every line a rule matches.
```

A rule's `blocks` says which matching lines are refused, so you can bring a rule in gradually:

| `blocks` | A line the branch adds | A line already in the code |
|---|---|---|
| `"added lines"`, when left out | blocked | counted |
| `"every line"` | blocked | blocked |
| `"nothing"` | listed | counted |

Start a rule at `"added lines"`. The count is what is left to clean up, and `grisha rules no-comments` lists each line. When the count reaches none, move the rule to `"every line"` and it stays that way. `"nothing"` is for a rule you want to see reported before you decide to enforce it.

The starter set from `grisha rules --init`: no comments, effects, timers, lint suppressions, optional clocks or errors read by their wording, and in tests no skips, mocks, spies, fake timers, real clock, sleeps, casts, SQL or hand-set database role. All of them block added lines. Every blocked line is logged once to `catches.jsonl`, which is your record of what the rules actually stop.

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
    { "name": "no-act", "pattern": "\\bact\\(", "files": "tests", "blocks": "every line", "fix": "Wait for what the user sees." },
    { "name": "no-casts-in-tests", "off": true }
  ]
}
```

A change to the rules does not take effect quietly. In the task above the agent turned the rule off for itself instead of deleting the comment:

```console
$ grisha gate
Before this goes further:
- The rules here are not the ones the person approved:
  no longer in force: no-comments
  Run `grisha rules --approve`: the person is shown what changed and asked.
(exit 1)
```

The agent asks, and this is what your app shows you:

```console
$ grisha rules --approve
Rules that differ from the ones you approved:
  no longer in force: no-comments
```

That is what happens when either of your two files changes: the gate refuses until you have seen the change and said yes. The committed file is read from the base branch, so a branch's edit to it changes nothing until it is merged, and the pull request is its review.

## Skills

| Skill | Use |
|---|---|
| `grisha` | How to plan a task as claims, and what to do between the steps `grisha next` gives. |
| `create-verification-skill`, `maintain-verification-skill` | Give a repository a scripted way to drive the real app, and keep it honest. |
| `create-formal-verification-skill`, `maintain-formal-verification-skill`, `statechart` | Check a property in every case with a model checker or prover, and show the result as a chart. |
| `blast-radius` | Find what a change could break elsewhere, and prove the one fact it is safe because of. |
| `no-comments` | Remove comments from a diff and turn the constraints they claim into code. |

All but the first come from [pstack](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan (MIT, see `skills/PSTACK-LICENSE`). Each folder's `UPSTREAM.json` records the commit, a checksum of every source file and what was changed. `bun run upstream` lists the ported files that have changed upstream since.

`statechart` installs Java and TLC through mise on its first run. To use a Java you already have, set `JAVA` and `TLA2TOOLS`.

## Development

```sh
git clone https://github.com/brianjmeier/grisha && cd grisha
bun install
bun link           # puts your clone's `grisha` on your PATH
bun test           # runs the command against real git repositories in temp folders
bun run check      # types
bun run session    # prints the task this page quotes
```

A test fails when an output quoted on this page is no longer what the command prints.

## Licence

MIT, see [LICENSE](LICENSE). The skills ported from pstack are © Lauren Tan, also MIT, see [skills/PSTACK-LICENSE](skills/PSTACK-LICENSE).
