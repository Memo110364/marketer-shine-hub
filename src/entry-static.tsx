// Plain client-side bootstrap for static hosting (Bluehost, or any host with
// no Node.js). TanStack Start's own SPA/prerender mode ships a hydration
// handoff that's still unstable on this stack (see TanStack/router#6806 and
// #5171 — fatal crashes / hangs), so this sidesteps it entirely: no
// prerendered markup, no hydrateRoot, just a normal client-rendered
// @tanstack/react-router app mounted into an empty div. Everything under
// src/routes keeps working as-is since none of it depends on SSR.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import "./styles.css";

const router = getRouter();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
