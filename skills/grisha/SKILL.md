---
name: grisha
description: Plan and build a task so every claim about it has a check that was run — "prove it works", "plan the verification first", "use grisha". Writes the modules, steps and claims to a sheet the person approves before any code, then builds one small step at a time with the `grisha` command. Use for a change the person will review as a pull request. Not for a read-only question or a throwaway prototype.
---

# Grisha

Grisha keeps one sheet per task: the modules the task touches (boxes), the build steps in order (units), and each unit's claims. You write the plan. Only the `grisha` command says where a claim stands, because it runs each check itself.

## The loop

1. `grisha start "<task>"` prints the sheet's path and the shape to write.
2. `grisha next` names the one thing to do now. Do it, and run `grisha next` again.
3. Stop when it exits 0. Then `grisha pr` prints the proof for the pull request body.

Every refusal from `grisha` says what to do about it. Do that instead of working around it. Quote `grisha show` when you report progress; never describe it from memory.

## Writing the plan

- **Claims first.** Before choosing files, say what must be true after (`proves`) and what must stay true elsewhere (`keeps`). In tightly coupled code most claims are `keeps`.
- **A box is a module**, named as the person would name it. Its `paths` include the files of its checks, so a weakened test makes its claims stale.
- **Pin before you move.** A `pin` unit records today's behaviour in a test. A pin that fails on today's code is a wrong pin: fix the pin, not the code, and make any bug it uncovers a unit of its own. When a claim cannot be checked until the code is reshaped, the pin and the `reshape` are the first units of the same branch.
- **Prefer a script or test.** Drive the real app when the claim is about what a user sees. `person reads` is for what no command can settle.

Show the person `grisha show`, and `grisha show --mermaid` as a diagram where the chat draws Mermaid. Change the sheet as they ask. Write no product code before they approve. Every later edit to the sheet needs approval again: say which box or claim you need to add and why.

`grisha approve` makes their agent app stop and ask them. If the answer is that nobody was asked, tell them to run it in a terminal, and wait.

## Between the steps

- A check for new behaviour must fail for the reason the claim names, not for a typo or a missing import. Each run names a file holding the check's output; read it.
- Write each test as a caller of the code would. [references/test-read.md](references/test-read.md) lists what a reader will send back.
- Never edit a check to make it pass. If the claim was wrong, change the claim on the sheet.
- Before committing a unit, have fresh subagents read it, one for each of [references/scope-read.md](references/scope-read.md), [references/design-read.md](references/design-read.md) and, when the unit adds or edits a test, [references/test-read.md](references/test-read.md). Each gets its file as its instructions, then the unit's claims and its uncommitted diff. Pass on what they find. Do not quietly remove or keep anything they name.
- On a branch stacked on another, add `--base <parent branch>`.

## Rules

`grisha rules` checks the lines this branch adds and prints the files the rules come from; `grisha help rules` prints the format. When the person corrects the same thing a second time, propose a rule for it: in the repository's file when it is about this codebase, in their own when it holds everywhere. Say what you changed and why, then run `grisha rules --approve`, which shows them the change and asks. Never change a rule to get a line through.

## Where things live

`grisha home` prints this repository's folder, outside the checkout. Its sheets and any `verify-*/` or `formal-*/` skill for it are there. Read `verify-*/SKILL.md` before writing a `drive app` check and `formal-*/SKILL.md` before a `model` check. If there is none, tell the person and offer the `create-verification-skill` or `create-formal-verification-skill` skill.

The `no-comments` and `blast-radius` skills can propose fixes of their own. Inside a task, each such fix is a new unit with its own claim, approved like any other.
