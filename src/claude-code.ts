export function bashCommand(hookInput: string): string {
  const call = JSON.parse(hookInput || "{}")
  return call.tool_name === "Bash" ? (call.tool_input?.command ?? "") : ""
}

export const deny = (reason: string) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } })
