/**
 * Vite configuration for the SPL Visualizer web app.
 * Dev server: http://localhost:5173
 */
import { defineConfig } from "vite";

export default defineConfig({
    root: ".",
    publicDir: "public",
    server: {
        port: 5173,
        open: true,
    },
});
