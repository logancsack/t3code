/**
 * Shows a startup failure before React replaces the boot splash. Self-contained:
 * the build inlines its source into index.html (vite.config.ts), so it must not
 * reference anything outside its own body.
 */
export function showAldoBootError(error: unknown) {
  console.error("Aldo failed to start.", error);
  const bootShell = document.getElementById("boot-shell");
  if (!bootShell) return;

  const content = document.createElement("div");
  content.id = "boot-error";
  content.setAttribute("role", "alert");

  const message = document.createElement("p");
  message.textContent = "Aldo could not load.";
  content.append(message);

  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload";
  reload.addEventListener("click", () => window.location.reload());
  content.append(reload);
  bootShell.replaceChildren(content);
}
