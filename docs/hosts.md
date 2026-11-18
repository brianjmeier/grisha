# Using proofsheet from a host

A host is whatever runs the agent: Claude Code, Codex, pi or an app of your own. Proofsheet knows nothing about any of them. A host does three things with it.

## 1. Ask before a command runs

Pass the command the agent is about to run. Proofsheet decides whether it has a say over it.

```sh
proofsheet gate --for "$command"
```

| The command | Answer |
|---|---|
| a commit | exit 1 and a list when the plan is unapproved, a claim is failing or stale, a rule is broken, or the rules differ from the ones the person approved |
| a push or `gh pr create` | the same, and also when a claim was never run, was never seen failing or has no check |
| `proofsheet approve` or `proofsheet rules --approve` | exit 1: approval belongs to the person |
| anything else, or outside a git repository | exit 0, nothing printed |

On exit 1 the host refuses the command and gives the agent the printed list. A block is a to-do, not a strike: the agent fixes it and makes the same call again, so a host must not remember the refusal against the command.

A host with no way to step in before a command can still call `proofsheet gate` and `proofsheet gate --final` itself at its own commit and hand-over steps.

## 2. Keep approval with the person

`proofsheet approve` approves a plan and `proofsheet rules --approve` approves a change to the person's rules. Both succeed only from a terminal, where they ask the person to type yes. An agent's shell is not a terminal, so its call is refused.

A host with its own approve button sets `PROOFSHEET_HOST_APPROVES=1` on the call it makes for the person. The agent can set that variable too, which is why step 1 refuses both commands when the agent sends them.

This stops an agent that approves its own plan, or turns off a rule, to be helpful. It does not stop one that forges an approval file: the agent runs as you, so nothing on your disk is out of its reach.

## 3. Draw the sheet

```sh
proofsheet show --json      # the plan with each claim's status, for any view
proofsheet show --mermaid   # the boxes as a flowchart
```

Status is worked out on each call from the recorded runs and the files as they are now. A view never stores it.

## Ways to wire step 1

**Git hooks, for any agent app.** Every agent commits and pushes through git, so two hook files cover all of them. `git rev-parse --git-path hooks` prints the folder to put them in. The files stay in your clone and are never committed.

```sh
# pre-commit
exec proofsheet gate

# pre-push
exec proofsheet gate --final
```

An agent can skip git hooks with `--no-verify`, and they do not see `proofsheet approve`. If the folder printed above is one the repository tracks (husky does this), a file added there would be shared with everyone, so use the app's own hook instead.

**Claude Code.** `proofsheet hook` is `gate --for` in Claude Code's `PreToolUse` shape. The agent cannot skip it.

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "proofsheet hook" }] }]
  }
}
```

**Other apps.** Wherever the app lets code see a command before it runs (a permission check, an extension), that code runs `proofsheet gate --for "$command"` and returns the list as the refusal. Nothing in this repository depends on any of them.
