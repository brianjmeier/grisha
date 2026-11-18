type BashCall = { command: string; input: Record<string, unknown> }

export function bashCall(hookInput: string): BashCall | null {
  let call: { tool_name?: unknown; tool_input?: Record<string, unknown> }
  try {
    call = JSON.parse(hookInput)
  } catch {
    throw new Error("`grisha hook` reads the JSON Claude Code sends a PreToolUse hook, and got something else. Check how the hook is wired.")
  }
  const command = call?.tool_input?.command
  return call?.tool_name === "Bash" && typeof command === "string" ? { command, input: call.tool_input ?? {} } : null
}

const decision = (permissionDecision: "deny" | "ask", reason: string, more: object = {}) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason: reason, ...more } })

export const deny = (reason: string) => decision("deny", reason)

export const askThePerson = (shown: string, call: BashCall, command: string) => decision("ask", shown, { updatedInput: { ...call.input, command } })
