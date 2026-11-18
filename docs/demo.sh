#!/bin/bash
# Walks one task through proofsheet in a throwaway repository and prints every answer.
# Usage: bash docs/demo.sh
set -uo pipefail

tool="$(cd "$(dirname "$0")/.." && pwd)/bin/proofsheet.ts"
export PROOFSHEET_HOME="$(mktemp -d)"
repo="$(mktemp -d)/shop"

proofsheet() { bun "$tool" "$@" | sed "s#$PROOFSHEET_HOME#~/.proofsheet#g"; return "${PIPESTATUS[0]}"; }
show() { printf '\n$ proofsheet %s\n' "$*"; proofsheet "$@"; local code=$?; [ "$code" -eq 0 ] || echo "(exit $code)"; }

mkdir -p "$repo/src/inbox" "$repo/test" && cd "$repo"
git init -q -b main && git config user.email someone@example.com && git config user.name Someone
echo 'echo 3' > src/inbox/count.sh
echo '[ "$(sh src/inbox/count.sh)" = "2" ]' > test/inbox.test.sh
git add . && git commit -q -m start

show start "Count only unread rows"

cat > "$PROOFSHEET_HOME/repos/shop/tasks/count-only-unread-rows/sheet.json" <<'EOF'
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
EOF

show show
show approve
PROOFSHEET_HOST_APPROVES=1 bun "$tool" approve > /dev/null
show run
echo 'echo 2' > src/inbox/count.sh
show run counts-unread
show gate --final
echo 'const total = 1' > src/billing.ts
show outside
show show --mermaid
show pr
