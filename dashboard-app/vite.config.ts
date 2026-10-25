import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from https://justinseby.github.io/dashboard/
export default defineConfig({
  base: "/dashboard/",
  plugins: [react()],
});
