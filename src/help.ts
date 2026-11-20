const HELP = `grisha: makes a coding agent show its work is done. Every claim about a task has a check
that was run, and rules block the lines a branch adds.

The loop
  grisha next         where the task stands and the one thing to do now.
                      Do it and run this again. Exit 0 means nothing is left.

Commands
  start "<task>"      begin a sheet for a task in this checkout, or pick it up again
  next                the one thing to do now
  show                the plan and where each claim stands (--json, --mermaid)
  approve             ask the person to approve the plan; nothing is run before their yes
  run [claim ...]     run the checks and record what happened
  rules [rule ...]    check the code against the rules, or list every line a rule matches (--init, --approve)
  outside             changed files that no planned box covers
  pr                  the record as a pull request section
  gate                exit 1 while something is known wrong (--validated: until every claim is validated)
  hook                the gate as a Claude Code PreToolUse hook
  home                where this repository's sheets and verification skills live
  help [topic]        topics: sheet, rules, hooks

  --base <ref>        compare against this ref instead of the default branch

Where a claim stands
  no check                     nobody has said how to check it
  for you to read              a person settles it, because no command can
  not run                      its check has not been run
  failing                      its check failed the last time it ran
  stale                        it passed, and code it covers has changed since
  passes, never seen failing   it passes, and has not shown that it can fail
  validated                    it failed once, passes now, and the code it covers is unchanged since`

const SHEET = `The sheet is the plan for one task, as JSON:

{
  "task": "Count only unread rows",
  "boxes": [
    { "name": "inbox/count", "paths": ["src/inbox/**", "test/inbox/**"], "calls": ["inbox/store"] },
    { "name": "inbox/store", "paths": ["src/store/**"] }
  ],
  "units": [
    {
      "name": "count unread rows",
      "kind": "change",
      "touches": ["inbox/count"],
      "claims": [
        { "id": "counts-unread", "says": "the badge shows the number of unread rows", "role": "proves",
          "check": { "how": "script", "run": "sh test/inbox/unread.test.sh" } },
        { "id": "other-tenants", "says": "another tenant's rows never count", "role": "keeps",
          "about": ["inbox/store"], "check": null }
      ]
    }
  ]
}

boxes   the modules the task touches. "paths" are the files a box covers, its checks included.
        "calls" names the boxes it calls, and can be left out.
units   the build steps, in order. "kind" is "pin" (record today's behaviour in a check before anything
        moves), "reshape" (move code while the pins keep passing) or "change" (alter behaviour).
        "touches" names the boxes the step changes.
claims  what must be true. "role" is "proves" (true after this step) or "keeps" (stays true).
        A claim goes stale when a file in its unit's boxes changes, or in the boxes "about" names.
check   "how" is "script", "test", "drive app", "model" or "person reads". "run" is the command,
        run from the repository root. "person reads" has no "run". null means undecided.

Any edit to the sheet needs the person's approval again.`

const RULES = `A rule is a pattern that lines of code may not match, with the fix for what it catches:

{
  "files": { "tests": ["**/*.test.*", "**/*.spec.*"] },
  "rules": [
    { "name": "no-comments", "pattern": "^\\\\s*//", "files": ["src/**"],
      "fix": "Delete the comment. Rename or restructure until the code says it." },
    { "name": "no-spies", "pattern": "\\\\bspyOn\\\\(", "files": "tests", "blocks": "every line",
      "fix": "Assert what a caller can see instead." }
  ]
}

files    named groups of file patterns. A rule's "files" is a group's name, or its own list of patterns.
pattern  a regular expression, tried on one line at a time.
blocks   which of the lines that match are refused. Left out, it is "added lines".
           "added lines"   a line this branch adds is refused. Lines already in the code are counted.
           "every line"    every line is refused, whoever wrote it.
           "nothing"       no line is refused. The ones this branch adds are listed.
         Start a rule at "added lines". When \`grisha rules\` counts none already in the code, move it to "every line".
off      { "name": "<rule>", "off": true } turns off a rule that an earlier file has.

Three files are read: the person's for every repository, this repository's committed file, and the
person's for this repository only. A later file adds rules, replaces one by name, or turns one off.
\`grisha rules\` prints where each file is.

The committed file is read from the base branch, so a branch's edit to it takes effect when it is merged.
A change to either of the person's files blocks until they approve it: \`grisha rules --approve\`.
Never change a rule to get a line through.`

const HOOKS = `When grisha runs is yours to choose. The two usual places:

Git hooks, for any agent app. \`git rev-parse --git-path hooks\` prints the folder to put them in.
  pre-commit    exec grisha gate
  pre-push      exec grisha gate --validated

Claude Code, in settings.json. An agent cannot skip it, and it is what lets the person approve in the app:
  { "hooks": { "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command":
    "grisha hook --before 'git commit' --validated-before 'git push' --validated-before 'gh pr create' || exit 2" }] }] } }

  --before "<words>"          refuse a command that contains these words while something is known wrong
  --validated-before "<words>"   refuse it until every claim is validated
  With neither, the hook only asks the person when the command is an approval.
  The words are looked for in the command as typed, so \`git -C <folder> commit\` is not \`git commit\`.
  Git hooks see every commit and push however it was typed.

Any other app: \`grisha gate --for "<command>"\` takes the same two flags and answers in plain text.
Exit 1 means refuse the command and show the agent what was printed. Exit 2 means ask the person.`

const TOPICS: Record<string, string> = { sheet: SHEET, rules: RULES, hooks: HOOKS }

export const helpOn = (topic?: string) => (topic === undefined ? HELP : (TOPICS[topic] ?? `No help on "${topic}". Topics: ${Object.keys(TOPICS).join(", ")}.\n\n${HELP}`))
