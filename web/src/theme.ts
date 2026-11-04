/** Light, dark, or whatever the manager's machine is set to. The choice is kept in this browser only;
 *  index.html applies it before the first paint so a dark portal never flashes white. */
export type Theme = "light" | "dark" | "system";

const media = window.matchMedia("(prefers-color-scheme: dark)");

export function savedTheme(): Theme {
  try {
    const theme = localStorage.getItem("theme");
    return theme === "light" || theme === "dark" ? theme : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme: Theme): void {
  try {
    if (theme === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", theme);
  } catch {
    // Storage blocked: the choice still holds until the page reloads.
  }
  document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && media.matches));
}

media.addEventListener("change", () => applyTheme(savedTheme()));
