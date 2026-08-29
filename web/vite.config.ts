import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// CheerpJ loads the jars from public/jars over HTTP range requests; Vite's dev server supports
// ranges and (deliberately) sets no COOP/COEP, which is exactly what CheerpJ 4.x needs.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // Relative asset paths so the build works both at the apex domain root (nitroviewer.com) and at
  // a GitHub project subpath (turtleisaac.github.io/NitroViewer/). The CheerpJ jar classpath is made
  // path-aware separately in the transport.
  base: "./",
});
