import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import StatsPage from "./StatsPage";
import SettingsPage from "./SettingsPage";
import { CartProvider } from "./CartContext";
import "./styles.css";

// Three plain pages, navigated via full <a> reloads (not client-side
// pushState) — simplest option here since App's filter state already lives
// entirely in the URL (see filterParams.ts) and restores itself on load
// regardless.
function currentPage() {
  if (window.location.pathname.startsWith("/stats")) return <StatsPage />;
  if (window.location.pathname.startsWith("/settings")) return <SettingsPage />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CartProvider>{currentPage()}</CartProvider>
  </React.StrictMode>,
);
