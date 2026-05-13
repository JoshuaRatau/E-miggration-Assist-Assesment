import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

// When `VITE_API_URL` is set at build time (Vercel cross-origin deploy),
// prepend it to every relative request the Orval-generated React Query
// hooks make. When unset (Replit same-origin), leave the base unchanged so
// requests resolve against the current origin via the shared proxy.
const apiBase = import.meta.env.VITE_API_URL;
if (apiBase) {
  setBaseUrl(apiBase);
}

createRoot(document.getElementById("root")!).render(<App />);
