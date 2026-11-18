---
name: proofsheet
description: Plan and build a task so every claim about it has a check that was run — "prove it works", "plan the verification first", "use a proof sheet". Writes the modules, steps and claims to a sheet the person approves before any code, then builds one small step at a time with the `proofsheet` command. Use for a change the person will review as a pull request. Not for a read-only question or a throwaway prototype.
---

# Proofsheet

A proof sheet is one file per task. It lists the modules the task touches (boxes), the build steps in order (units), and each unit's claims: what the step proves, and what it keeps true elsewhere.

You write the plan. Only the `proofsheet` command says where a claim stands, because it runs each check itself. A claim is never proven because you say so, so quote `proofsheet show` instead of describing progress from memory.

## 1. Write the claims, then the map

`proofsheet start "Count only unread rows"` answers with the sheet's path. Write into it:

```json
{
  "task": "Count only unread rows",
  "boxes": [
    { "name": "inbox/count", "paths": ["src/inbox/**", "test/inbox.test.sh"], "calls": ["inbox/store"] },
    { "name": "inbox/store", "paths": ["src/store/**"] }
  ],
  "units": [
    {
      "name": "count unread rows",
      "kind": "change",
      "touches": ["inbox/count"],
      "claims": [
        { "id": "counts-unread", "says": "the badge shows the number of unread rows", "role": "proves",
          "check": { "how": "script", "run": "sh test/inbox.test.sh" } },
        { "id": "other-tenants", "says": "another tenant's rows never count", "role": "keeps", "check": null }
      ]
    }
  ]
}
```

- **Claims first.** Before choosing files, say what must be true after (`proves`) and what must stay true elsewhere (`keeps`). In tightly coupled code most claims are `keeps`. A claim about a box its unit does not change lists that box in `"about": ["inbox/store"]`, so it goes stale when that box changes.
- **A box is a module**, named as the person would name it. Its `paths` include the files of its checks, so a weakened test makes its claims stale. `calls` names the boxes it calls, for the drawn map.
- **Unit kinds.** `pin` records today's behaviour in a test before anything moves. A pin that fails on today's code is a wrong pin: fix the pin, not the code, and make any bug it uncovers a unit of its own. `reshape` moves code while the pin keeps passing. `change` alters behaviour. When a claim cannot be checked until the code is reshaped, the pin and the reshape are the first units of the same branch.
- **`how`** is `script`, `test`, `drive app`, `model` or `person reads`. Prefer a script or test. Drive the real app when the claim is about what a user sees. `run` is a command, run from the repository root. `person reads` has no `run` and is for what no command can settle. `null` means undecided, and it blocks the push.

## 2. The person approves the plan

Show them `proofsheet show`, and the output of `proofsheet show --mermaid` as a diagram where the chat draws Mermaid. Change the sheet as they ask. They approve it themselves. When you try, the answer is:

> The person approves it by running `proofsheet approve` in their own terminal.

Write no product code before that. Every later edit to the sheet needs approval again, which is how a plan grows in the open: say which box or claim you need to add and why, then wait.

## 3. Build one unit at a time

1. Write the unit's checks and run them: `proofsheet run counts-unread`. Write each test as a caller of the code would; [references/test-read.md](references/test-read.md) lists what a reader will send back. A check for new behaviour must read `[failing]`, and its output must show it fails for the reason the claim names, not for a typo or a missing import. A pin, or any check that reads `[passes, never seen failing]`, has not shown it can fail, and blocks the push until it has: break the code on purpose once, run it, restore the code and run it again.
2. Make the change and run again until each reads `[proven]`. Each run names a file holding the check's output; read it when a check fails.
3. Run `proofsheet show`. `[stale]` on a claim means you changed code it covers. Run that claim again.
4. Have fresh subagents read the unit, one for each of [references/scope-read.md](references/scope-read.md), [references/design-read.md](references/design-read.md) and, when the unit adds or edits a test, [references/test-read.md](references/test-read.md). Each gets its file as its instructions, then the unit's claims and its uncommitted diff. Pass on what they find. Do not quietly remove or keep anything they name.
5. Run `proofsheet gate`, clear what it lists, and commit the unit.

Never edit a check to make it pass. If the claim was wrong, change the claim on the sheet and ask for approval.

## 4. Hand over

- `proofsheet gate --final` lists what still blocks a push.
- `proofsheet outside` lists changed files that no box covers. Say why each one changed. On a branch stacked on another, add `--base <parent branch>`.
- `proofsheet pr` prints the proof as a section for the pull request body.

## Where things live

`proofsheet home` prints this repository's folder, outside the checkout. Its sheets and any `verify-*/` or `formal-*/` skill for it are there. Read `verify-*/SKILL.md` before writing a `drive app` check and `formal-*/SKILL.md` before a `model` check. If there is none, tell the person and offer the `create-verification-skill` or `create-formal-verification-skill` skill.

`proofsheet rules` checks the lines this branch adds and prints the files the rules come from: the person's own, then the repository's. When the person corrects the same thing a second time, propose a rule for it: in the repository's file when it is about this codebase, in their own when it holds everywhere. A change to their rules blocks every commit until they approve it with `proofsheet rules --approve`, so say what you changed and why, then wait. Never edit a rule to get a line through.

The `no-comments` and `blast-radius` skills can propose fixes of their own. Inside a task, each such fix is a new unit with its own claim, approved like any other.
