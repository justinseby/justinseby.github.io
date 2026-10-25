import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from https://justinseby.github.io/dashboard/
export default defineConfig({
  base: "/dashboard/",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Libraries change rarely; separate files stay cached between deploys.
        manualChunks: {
          react: ["react", "react-dom"],
          supabase: ["@supabase/supabase-js"],
          markdown: ["react-markdown", "remark-gfm"],
        },
      },
    },
  },
});
