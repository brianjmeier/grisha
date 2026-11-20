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
