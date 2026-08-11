import "./assets/main.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App, { AppProviders } from "./App";
import { DesktopPetApp } from "./components/DesktopPetApp";
import { applySkin } from "./lib/theme";

applySkin("white");

const surface = new URLSearchParams(window.location.search).get("surface");
document.documentElement.dataset.surface = surface === "pet" ? "pet" : "main";
const root =
  surface === "pet" ? (
    <AppProviders>
      <DesktopPetApp />
    </AppProviders>
  ) : (
    <App />
  );

createRoot(document.getElementById("root")!).render(<StrictMode>{root}</StrictMode>);
