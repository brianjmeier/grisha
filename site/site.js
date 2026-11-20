const root = document.documentElement
root.classList.add("js")

const STAGES = ["Draft", "Submitted", "Checked", "Rewritten", "Sent back", "Rechecked", "Rechecked", "Sent back", "Approved", "Accepted"]
const MS_PER_LETTER = 26
const SHORTEST_MS = 5000
const LONGEST_MS = 9000

document.addEventListener("DOMContentLoaded", () => {
  const status = document.querySelector("[data-status]")
  const task = document.querySelector("[data-task]")
  const proofs = task.querySelector(".proofs")
  const frames = [...task.querySelectorAll(".frame")]
  const parts = [...task.querySelectorAll("[data-from], [data-until]")]
  const controls = task.querySelector(".controls")
  const toggle = controls.querySelector('[data-go="toggle"]')
  const readingTime = frames.map((frame) => {
    const letters = frame.textContent.replace(/\s+/g, " ").length
    return Math.min(LONGEST_MS, Math.max(SHORTEST_MS, letters * MS_PER_LETTER))
  })
  let at = 0
  let timer = 0
  let seen = false
  let wanted = !matchMedia("(prefers-reduced-motion: reduce)").matches

  for (const button of document.querySelectorAll(".copy")) {
    button.hidden = false
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.previousElementSibling.textContent)
      } catch {
        return
      }
      button.textContent = "copied"
    })
  }

  const stateAt = (part, frame) => {
    const from = Number(part.dataset.from ?? 0)
    const until = part.dataset.until === undefined ? Infinity : Number(part.dataset.until)
    if (frame < from || frame > until) return "off"
    if (frame === until) return part.tagName === "DEL" ? "struck" : "off"
    if (frame === Number(part.dataset.flag)) return "flagged"
    return frame === from && from > 0 ? "new" : "on"
  }

  const mark = (frame) => {
    for (const part of parts) part.dataset.state = stateAt(part, frame)
  }

  const show = (frame) => {
    at = (frame + frames.length) % frames.length
    mark(at)
    frames.forEach((element, index) => element.classList.toggle("on", index === at))
    root.dataset.stage = STAGES[at].toLowerCase()
    root.style.setProperty("--draft", String(1 - at / (frames.length - 1)))
    status.textContent = STAGES[at]
    status.classList.remove("changed")
    void status.offsetWidth
    status.classList.add("changed")
  }

  const measure = () => {
    proofs.style.minHeight = ""
    let tallest = 0
    for (let frame = 0; frame < frames.length; frame += 1) {
      mark(frame)
      tallest = Math.max(tallest, proofs.offsetHeight)
    }
    proofs.style.minHeight = `${tallest}px`
    mark(at)
  }

  const run = () => {
    clearTimeout(timer)
    toggle.textContent = wanted ? "pause" : "play"
    if (!wanted || !seen || document.hidden) return
    timer = setTimeout(() => {
      show(at + 1)
      run()
    }, readingTime[at])
  }

  controls.addEventListener("click", (event) => {
    const go = event.target.closest("button")?.dataset.go
    if (!go) return
    if (go === "toggle") wanted = !wanted
    else {
      wanted = false
      show(at + (go === "next" ? 1 : -1))
    }
    run()
  })

  new IntersectionObserver(([entry]) => {
    seen = entry.isIntersecting
    run()
  }, { threshold: 0.6 }).observe(task)
  document.addEventListener("visibilitychange", run)

  let width = window.innerWidth
  addEventListener("resize", () => {
    if (window.innerWidth === width) return
    width = window.innerWidth
    measure()
  })

  show(0)
  measure()
  document.fonts?.ready.then(measure)
})
