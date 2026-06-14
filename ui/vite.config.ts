import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Browser hits Caddy (single origin, see ARCHITECTURE §11.1).
// No Vite proxy needed — fetch('/api/...') reaches api through Caddy.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: "0.0.0.0", port: 5173 },
});
