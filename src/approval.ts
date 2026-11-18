import { createHash } from "node:crypto"
import { asText } from "./render"
import { approveRules, ruleFiles, unapprovedRules } from "./rules"
import { approve, currentTask, noUnits, sheetProblems, view, type Place } from "./sheet"
import type { World } from "./world"

export const NO_TASK = 'No task is started in this checkout. Begin with: grisha start "<task>"'
export const NOBODY_WAS_ASKED =
  "Nobody was asked, so nothing is approved. `grisha hook` is what makes an agent app stop and ask the person, and it is not wired here. Until it is, the person runs this command in a terminal."
export const ASKED_ABOUT_SOMETHING_ELSE = "This is not what the person was asked to approve: it changed after they were asked. Run the command again so they are asked about what is here now."

type Asked = { shown: string; approve: () => void } | { nothing: string; fine: boolean }

export const markOf = (shown: string) => createHash("sha256").update(shown).digest("hex").slice(0, 12)

export function toApprove(world: World, here: Place, base: () => string, what: "plan" | "rules"): Asked {
  if (what === "rules") {
    const files = ruleFiles(world, here, base())
    const changes = unapprovedRules(files)
    if (changes.length === 0) return { nothing: "The rules here are the ones already approved.", fine: true }
    return { shown: ["Rules that differ from the ones you approved:", ...changes.map((row) => `  ${row}`)].join("\n"), approve: () => approveRules(world, files) }
  }
  const task = currentTask(world, here)
  if (!task) return { nothing: NO_TASK, fine: false }
  if ("problems" in task) return { nothing: sheetProblems(task).join("\n"), fine: false }
  if (task.sheet.units.length === 0) return { nothing: noUnits(task), fine: false }
  if (task.approval === "approved") return { nothing: "The plan is already approved.", fine: true }
  return { shown: asText(view(world, here, task)), approve: () => approve(world, task) }
}

export async function confirm(world: World, shown: string): Promise<"yes" | "no" | "unavailable" | "something else"> {
  if (world.approved !== null) return world.approved === markOf(shown) ? "yes" : "something else"
  if (!world.ask) return "unavailable"
  return (await world.ask(`${shown}\n\nApprove this? Type yes: `)).trim().toLowerCase() === "yes" ? "yes" : "no"
}
