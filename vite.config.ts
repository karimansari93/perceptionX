import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
import { componentTagger } from "lovable-tagger";

// Emits dist/onboarding.html — index.html with onboarding-specific meta tags.
// Netlify serves it for /onboarding/* (see public/_redirects) so link-preview
// crawlers that never execute JS still get project-setup copy instead of the
// sign-in copy. Keep the strings in sync with the generic fallback in
// src/pages/Onboarding.tsx; the company-name personalization there still
// applies on top for crawlers (and browsers) that run JS.
function onboardingHtml(): Plugin {
  const title = "Project Setup — PerceptionX";
  const description =
    "You've been invited to set up your company's PerceptionX project. Complete your brief to see how AI describes your employer brand.";
  return {
    name: "onboarding-html",
    apply: "build",
    closeBundle() {
      const distDir = path.resolve(__dirname, "dist");
      const indexPath = path.join(distDir, "index.html");
      if (!fs.existsSync(indexPath)) return;
      const html = fs
        .readFileSync(indexPath, "utf8")
        .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
        .replace(
          /(<meta name="description" content=")[^"]*(")/,
          `$1${description}$2`,
        )
        .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`)
        .replace(
          /(<meta property="og:description" content=")[^"]*(")/,
          `$1${description}$2`,
        );
      fs.writeFileSync(path.join(distDir, "onboarding.html"), html);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    // Listen on all interfaces (IPv4 + IPv6 when available). The previous
    // "::" only bound IPv6, which fails on IPv4-only hosts (Claude Code web
    // sandboxes, some CI runners) with EAFNOSUPPORT and blocks preview.
    host: true,
    // Honor an assigned port (preview harness/worktrees) but keep 8080 as
    // the default for local dev.
    port: process.env.PORT ? Number(process.env.PORT) : 8080,
  },
  plugins: [
    react(),
    onboardingHtml(),
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          ui: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-tabs'],
          charts: ['recharts'],
          utils: ['date-fns', 'clsx', 'class-variance-authority'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
    minify: mode === 'production' ? 'terser' : false,
    terserOptions: mode === 'production' ? {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    } : undefined,
  },

}));
