document.documentElement.classList.add("js")

const STAGES = ["Draft", "Submitted", "Checked", "Rewritten", "Sent back", "Rechecked", "Rechecked", "Sent back", "Approved", "Accepted"]

document.addEventListener("DOMContentLoaded", () => {
  const root = document.documentElement
  const status = document.querySelector("[data-status]")
  const head = document.querySelector(".running")
  const task = document.querySelector("[data-task]")
  const pin = task.querySelector(".pin")
  const proofs = task.querySelector(".proofs")
  const frames = [...task.querySelectorAll(".frame")]
  const parts = [...task.querySelectorAll("[data-from], [data-until]")]
  let shown = -1
  let width = 0
  let settled = false

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

  const show = (frame) => {
    if (frame === shown) return
    shown = frame
    for (const part of parts) part.dataset.state = stateAt(part, frame)
    frames.forEach((element, index) => element.classList.toggle("on", index === frame))
  }

  const place = () => {
    const top = parseFloat(getComputedStyle(pin).top) || 0
    const span = task.offsetHeight - pin.offsetHeight
    const done = span > 0 ? Math.min(1, Math.max(0, (top - task.getBoundingClientRect().top) / span)) : 0
    const frame = Math.min(frames.length - 1, Math.floor(done * frames.length))
    show(frame)
    root.style.setProperty("--draft", String(1 - frame / (frames.length - 1)))
    const stage = STAGES[frame]
    if (status.textContent === stage) return
    status.textContent = stage
    status.classList.remove("changed")
    if (!settled) return
    void status.offsetWidth
    status.classList.add("changed")
  }

  const measure = () => {
    const now = shown
    proofs.style.minHeight = ""
    let tallest = 0
    for (let frame = 0; frame < frames.length; frame += 1) {
      show(frame)
      tallest = Math.max(tallest, proofs.offsetHeight)
    }
    proofs.style.minHeight = `${tallest}px`
    show(Math.max(now, 0))
    const room = window.innerHeight
    const below = head.offsetHeight + 12
    const spare = room - pin.offsetHeight
    pin.style.top = `${Math.round(spare < below ? spare : Math.max(below, spare * 0.36))}px`
    const step = Math.min(340, Math.max(220, room * 0.34))
    task.style.height = `${Math.round(pin.offsetHeight + frames.length * step)}px`
    place()
  }

  let waiting = false
  const later = () => {
    if (waiting) return
    waiting = true
    requestAnimationFrame(() => {
      waiting = false
      place()
    })
  }

  addEventListener("scroll", later, { passive: true })
  addEventListener("resize", () => {
    if (window.innerWidth === width) return later()
    width = window.innerWidth
    measure()
  })
  width = window.innerWidth
  measure()
  settled = true
  document.fonts?.ready.then(measure)
})
