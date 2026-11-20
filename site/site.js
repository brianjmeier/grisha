for (const button of document.querySelectorAll(".copy")) {
  button.addEventListener("click", async () => {
    const command = button.previousElementSibling.textContent.replace(/^\$ /, "")
    try {
      await navigator.clipboard.writeText(command)
    } catch {
      return
    }
    button.textContent = "copied"
  })
}

const STEP_MS = 6500
const TICK = '<svg viewBox="0 0 48 40" aria-hidden="true"><path pathLength="1" d="M4 22 C 9 25, 14 31, 17 37 C 23 21, 33 9, 45 3"/></svg>'
const CROSS = '<svg viewBox="0 0 40 40" aria-hidden="true"><path pathLength="1" d="M6 5 C 14 14, 26 26, 35 36 M34 6 C 26 14, 14 27, 5 35"/></svg>'

const afterChange = { approved: true, "counts-unread": `${TICK}proven.`, "still-a-number": "stale." }
const bothProven = { ...afterChange, "still-a-number": `${TICK}proven. It failed first.` }
const settled = { ...bothProven, "other-tenants": "for you to read.", read: true }
const SHEET_AT_STEP = [
  {},
  {},
  { approved: true },
  { approved: true, "counts-unread": `${CROSS}failing. Good.`, "still-a-number": "passes. Never seen failing." },
  afterChange,
  { ...afterChange, verdict: "Not yet." },
  bothProven,
  { ...bothProven, added: true },
  settled,
  { ...settled, verdict: "Now it's done. &mdash; Grisha" },
]

function play(demo) {
  const opening = demo.querySelector(".opening")
  const task = demo.querySelector(".task-scene")
  const steps = [...demo.querySelectorAll(".flow li")]
  const titles = [opening.dataset.title, ...steps.map((step) => step.querySelector("h2").textContent)]
  const paper = demo.querySelector(".paper")
  const marks = [...paper.querySelectorAll("[data-mark]")]
  const how = paper.querySelector("[data-how]")
  const added = paper.querySelector("[data-added]")
  const approved = paper.querySelector("[data-approved]")
  const verdict = paper.querySelector("[data-verdict]")
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches
  let at = 0
  let timer = null
  let wanted = !still
  let seen = false

  const controls = document.createElement("div")
  controls.className = "controls"
  controls.innerHTML = `<button type="button" data-go="back">back</button><ol class="numbers">${titles.map((_, index) => `<li><button type="button" data-step="${index}">${index + 1}</button></li>`).join("")}</ol><button type="button" data-go="next">next</button><button type="button" data-go="toggle"></button>`
  demo.querySelector(".stage").before(controls)
  const toggle = controls.querySelector('[data-go="toggle"]')
  const numbers = [...controls.querySelectorAll("[data-step]")]
  numbers.forEach((button, index) => button.setAttribute("aria-label", `Step ${index + 1}: ${titles[index]}`))

  const restart = (element, name, on) => {
    element.classList.remove(name)
    void element.offsetWidth
    if (on) element.classList.add(name)
  }
  const write = (element, html) => {
    if (element.dataset.shown === html) return
    element.dataset.shown = html
    element.innerHTML = html
    restart(element, "fresh", Boolean(html))
  }
  const show = (index) => {
    const from = at
    at = (index + titles.length) % titles.length
    const sheet = SHEET_AT_STEP[at]
    opening.classList.toggle("away", at !== 0)
    task.classList.toggle("away", at === 0)
    if (at === 0 && from !== 0) restart(opening, "go", true)
    steps.forEach((step, each) => step.classList.toggle("now", each === at - 1))
    numbers.forEach((button, each) => (each === at ? button.setAttribute("aria-current", "step") : button.removeAttribute("aria-current")))
    for (const mark of marks) write(mark, sheet[mark.dataset.mark] ?? "")
    write(verdict, sheet.verdict ?? "")
    how.textContent = sheet.read ? "by person reads" : "by nothing yet"
    approved.style.visibility = sheet.approved ? "visible" : "hidden"
    added.classList.toggle("off", !sheet.added)
    added.classList.toggle("fresh", Boolean(sheet.added))
  }
  const run = () => {
    clearInterval(timer)
    timer = wanted && seen ? setInterval(() => show(at + 1), STEP_MS) : null
    toggle.textContent = wanted ? "pause" : "play"
  }

  controls.addEventListener("click", (event) => {
    const button = event.target.closest("button")
    if (!button) return
    if (button.dataset.go === "toggle") wanted = !wanted
    else {
      wanted = false
      show(button.dataset.step ? Number(button.dataset.step) : at + (button.dataset.go === "next" ? 1 : -1))
    }
    run()
  })
  new IntersectionObserver(([entry]) => {
    seen = entry.isIntersecting
    run()
  }, { threshold: 0.35 }).observe(demo.querySelector(".stage"))

  demo.classList.add("plays")
  show(0)
  run()
}

for (const demo of document.querySelectorAll(".demo")) play(demo)
