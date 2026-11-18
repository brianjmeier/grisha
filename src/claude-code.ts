export function bashCommand(hookInput: string): string {
  let call: { tool_name?: unknown; tool_input?: { command?: unknown } }
  try {
    call = JSON.parse(hookInput)
  } catch {
    throw new Error("`grisha hook` reads the JSON Claude Code sends a PreToolUse hook, and got something else. Check how the hook is wired.")
  }
  return call?.tool_name === "Bash" && typeof call.tool_input?.command === "string" ? call.tool_input.command : ""
}

export const deny = (reason: string) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } })
