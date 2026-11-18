import { claimsOf, leftToRead, type Check, type View } from "./sheet"

const tally = (claims: { status: string }[]) =>
  [...Map.groupBy(claims, (claim) => claim.status)].map(([status, same]) => `${same.length} ${status}`).join(", ")

const count = (many: number, word: string) => `${many} ${word}${many === 1 ? "" : "s"}`

const checkLine = (check: Check | null) => (check === null ? "nothing yet" : check.run ? `${check.how}: ${check.run}` : check.how)

export function inBrief(view: View): string[] {
  const claims = claimsOf(view.units)
  return [view.task, `plan ${view.approval} · ${count(view.units.length, "unit")} · ${count(claims.length, "claim")}: ${tally(claims) || "none yet"}`]
}

export function asText(view: View): string {
  const rows = inBrief(view)
  view.units.forEach((unit, index) => {
    rows.push("", `${index + 1} ${unit.kind}  ${unit.name}    touches ${unit.touches.join(", ")}`)
    for (const claim of unit.claims) {
      rows.push(`    ${claim.role.padEnd(6)}  ${claim.id}: ${claim.says}    [${claim.status}]`)
      rows.push(`            by ${checkLine(claim.check)}`)
    }
  })
  return rows.join("\n")
}

export function asMermaid(view: View): string {
  const id = (name: string) => `b${view.boxes.findIndex((box) => box.name === name)}`
  const rows = ["flowchart LR"]
  for (const box of view.boxes) {
    const touching = view.units.filter((unit) => unit.touches.includes(box.name))
    rows.push(`  ${id(box.name)}["${box.name}<br/>${tally(claimsOf(touching)) || "not touched"}"]`)
    for (const called of box.calls ?? []) rows.push(`  ${id(box.name)} --> ${id(called)}`)
  }
  return rows.join("\n")
}

export function asPullRequest(view: View, outside: string[]): string {
  const rows = ["## How this was proven", ""]
  view.units.forEach((unit, index) => {
    rows.push(`${index + 1}. **${unit.name}** (${unit.kind})`)
    for (const claim of unit.claims) rows.push(`   - ${claim.says}: **${claim.status}**, by ${checkLine(claim.check)}`)
  })
  const toRead = leftToRead(view)
  if (toRead.length > 0) rows.push("", "## Left for a person to read", "", ...toRead.map((claim) => `- ${claim.says}`))
  if (outside.length > 0) rows.push("", "## Changed outside the planned modules", "", ...outside.map((file) => `- \`${file}\``))
  return rows.join("\n")
}
