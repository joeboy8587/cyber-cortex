import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const rootElement = document.getElementById("root");

if (rootElement) {
  try {
    createRoot(rootElement).render(<App />);
  } catch (error) {
    console.error("Failed to render app:", error);
    rootElement.innerHTML = `
      <div style="background: #1a1a2e; color: #00ffff; min-height: 100vh; display: flex; align-items: center; justify-content: center; font-family: monospace; padding: 20px;">
        <div style="text-align: center;">
          <h1 style="color: #ff0055;">App Failed to Load</h1>
          <p>${error instanceof Error ? error.message : 'Unknown error'}</p>
          <button onclick="window.location.reload()" style="margin-top: 20px; padding: 10px 20px; background: #00ffff; color: #1a1a2e; border: none; cursor: pointer;">
            Reload
          </button>
        </div>
      </div>
    `;
  }
} else {
  console.error("Root element not found");
}
