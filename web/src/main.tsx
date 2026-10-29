import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// The portal follows the manager's own machine rather than offering a switch nobody asked for.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const theme = (): void => {
  document.documentElement.classList.toggle("dark", dark.matches);
};
theme();
dark.addEventListener("change", theme);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
