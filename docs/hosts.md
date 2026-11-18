# Using grisha from a host

A host is whatever runs the agent: Claude Code, Codex, pi or an app of your own. Grisha knows nothing about any of them. A host does three things with it.

## 1. Decide when work is stopped

Grisha answers two questions and has no opinion on when you ask them.

```sh
grisha gate            # exit 1 while something is known wrong
grisha gate --proven   # exit 1 until every claim is proven
```

| Asked | Exit 1 and a list when |
|---|---|
| `gate` | the plan is unapproved, a claim is failing or stale, a rule is broken, or the rules differ from the ones the person approved |
| `gate --proven` | the same, and also when a claim was never run, was never seen failing or has no check |

A host that sees each command before it runs can pass the command and say which words mean which question:

```sh
grisha gate --for "$command" --before "git commit" --proven-before "git push"
```

| The command | Answer |
|---|---|
| contains the words after a `--before` | what `gate` answers |
| contains the words after a `--proven-before` | what `gate --proven` answers |
| `grisha approve` or `grisha rules --approve` | exit 2, what the person must see, and a mark on the last line; exit 1 and the reason when there is nothing to approve |
| anything else, or outside a git repository | exit 0, nothing printed |

The words match as whole words with any spacing, so `git commit` matches `git  commit -m wip` and not `git commit-tree`. Both flags can be given more than once. Each `cd <folder>` in the command is followed in order, and the command is judged in the folder it ends in. When a folder is not written out, as in `cd "$REPO"`, the command is refused with a line asking for it to be.

Matching words in a command is a convenience, not a guarantee: `git -C <folder> commit` does not contain the words `git commit`, and an agent can always spell a command another way. Git hooks see every commit and push however they were typed, so wire them as well when you want nothing to slip past.

On exit 1 the host refuses the command and gives the agent the printed list. Each line says what to do, so the list is the agent's next prompt. A block is a to-do, not a strike: the agent fixes it and makes the same call again, so a host must not remember the refusal against the command. On exit 2 the host asks the person, as section 2 describes.

## 2. Put approval in front of the person

`grisha approve` approves a plan and `grisha rules --approve` approves a change to the person's rules. The agent runs the command and the host asks the person.

```console
$ grisha gate --for "grisha approve"
Count only unread rows
plan not approved · 1 unit · 1 claim: 1 not run
…
Ask the person. On their yes, run the command with this set:
GRISHA_APPROVED=b1a212b3ad5b
(exit 2)
```

The host shows the person everything above the last two lines. On their yes it runs the agent's command with that variable set. The mark is a fingerprint of the text shown, and the command approves only when what it would show now has the same mark. A plan edited between the question and the answer is not approved, and the answer says so.

With no host asking, the command works in a terminal: it shows the same text and asks the person to type yes. Anywhere else it approves nothing and says nobody was asked.

This stops an agent that approves its own plan, or turns off a rule, to be helpful. With a host asking, an agent that sets the variable on the command is still stopped, because the host asks about that command either way. It does not stop an agent that sets out to forge an approval. The mark is a fingerprint, not a secret: the agent can work it out, hide the command from the host inside a script, or write the approval file itself. The agent runs as you, so nothing grisha could keep on your disk is out of its reach.

## 3. Draw the sheet

```sh
grisha show --json      # the plan with each claim's status, for any view
grisha show --mermaid   # the boxes as a flowchart
```

Status is worked out on each call from the recorded runs and the files as they are now. A view never stores it.

## The two usual places

**Git hooks, for any agent app.** Every agent commits and pushes through git, so two hook files cover all of them. `git rev-parse --git-path hooks` prints the folder to put them in. The files stay in your clone and are never committed.

```sh
# pre-commit
exec grisha gate

# pre-push
exec grisha gate --proven
```

An agent can skip git hooks with `--no-verify`, and a git hook never sees `grisha approve`, so with git hooks alone the person approves in a terminal. If the folder printed above is one the repository tracks (husky does this), a file added there would be shared with everyone, so use the app's own hook instead.

**Claude Code.** `grisha hook` is `gate --for` in Claude Code's `PreToolUse` shape, with the same two flags. The agent cannot skip it. For an approval it answers `ask`: the plan or the rule changes become the text of the permission prompt, and the command is rewritten to carry the mark. With neither flag it only does that. When it cannot read its input or git fails under it, it refuses the command and says why. The `|| exit 2` covers the case it cannot handle itself: if `grisha` is missing or crashes, Claude Code would otherwise let the command through, and exit 2 is the code it treats as a refusal.

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command",
      "command": "grisha hook --before 'git commit' --proven-before 'git push' --proven-before 'gh pr create' || exit 2" }] }]
  }
}
```

**Other apps.** Wherever the app lets code see a command before it runs (a permission check, an extension), that code runs `grisha gate --for "$command"` with the flags you choose, returns the list as the refusal on exit 1, and asks the person on exit 2. Nothing in this repository depends on any of them.
