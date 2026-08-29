import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// CheerpJ loads the jars from public/jars over HTTP range requests; Vite's dev server supports
// ranges and (deliberately) sets no COOP/COEP, which is exactly what CheerpJ 4.x needs.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // Large base64 PNG/JSON crossing from the JVM is fine; keep the default build.
});
