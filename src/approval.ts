import { asText } from "./render"
import { approveRules, ruleFiles, unapprovedRules } from "./rules"
import { approve, currentTask, noUnits, usable, view, whyUnusable, type Place } from "./sheet"
import { sha } from "./text"
import type { World } from "./world"

type Asked = { shown: string; approve: () => void } | { nothing: string; fine: boolean }

export const markOf = (shown: string) => sha(shown).slice(0, 12)

export function toApprove(world: World, here: Place, base: () => string, what: "plan" | "rules"): Asked {
  if (what === "rules") {
    const files = ruleFiles(world, here, base())
    const changes = unapprovedRules(files)
    if (changes.length === 0) return { nothing: "The rules here are the ones already approved.", fine: true }
    return { shown: ["Rules that differ from the ones you approved:", ...changes.map((row) => `  ${row}`)].join("\n"), approve: () => approveRules(world, files) }
  }
  const task = currentTask(world, here)
  if (!usable(task)) return { nothing: whyUnusable(task).join("\n"), fine: false }
  if (task.sheet.units.length === 0) return { nothing: noUnits(task), fine: false }
  if (task.approval === "approved") return { nothing: "The plan is already approved.", fine: true }
  return { shown: asText(view(world, here, task)), approve: () => approve(world, task) }
}

export async function refusal(world: World, shown: string): Promise<string | null> {
  if (world.approved !== null) {
    return world.approved === markOf(shown) ? null : "This is not what the person was asked to approve: it changed after they were asked. Run the command again so they are asked about what is here now."
  }
  if (!world.ask) {
    return "Nobody was asked, so nothing is approved. `grisha hook` is what makes an agent app stop and ask the person, and it is not wired here. Until it is, the person runs this command in a terminal."
  }
  const typed = await world.ask(`${shown}\n\nApprove this? Type yes: `)
  return typed.trim().toLowerCase() === "yes" ? null : "Not approved. Ask the person what they want changed, change it, then run this command again."
}
