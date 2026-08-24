import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";

// Emits the static per-route HTML variants: index.html with different meta
// tags, served by Netlify for /onboarding/* and /activate/* (see
// public/_redirects) so a link-preview crawler that never executes JS gets copy
// about the page it was actually sent, rather than the dashboard sign-in copy.
//
// These are the floor, not the finished preview. The edge functions in
// netlify/edge-functions personalize them per token on top — the client's name
// on an Activate link, the company name on an onboarding invite — and fall back
// to exactly these strings whenever that lookup can't run. Keep them in sync
// with the generic fallbacks in src/pages/Onboarding.tsx and src/pages/Activate.tsx.
interface MetaVariant {
  file: string;
  title: string;
  description: string;
  image?: string;
  imageAlt?: string;
  robots?: string;
  /** Drop og:url and canonical, for a variant whose real URL is per-token. */
  dropUrl?: boolean;
}

const META_VARIANTS: MetaVariant[] = [
  {
    file: "onboarding.html",
    title: "Project Setup — PerceptionX",
    description:
      "You've been invited to set up your company's PerceptionX project. Complete your brief to see how AI describes your employer brand.",
  },
  {
    file: "activate.html",
    // The conversation is the subject, and it is already happening — which is
    // both true and the only honest reason to tap a link forwarded into a
    // WhatsApp thread. Non-directive like the page: it says where the
    // conversation is, never that you should join it. Canonical wording lives
    // in previewCopy() in netlify/lib/activate-card.js.
    title: "Join the online conversation about where you work",
    description:
      "See where people are already talking about working there, and where your experience would count.",
    image: "https://app.perceptionx.ai/logos/activate-og.png",
    imageAlt: "PerceptionX Activate",
    // Activate URLs carry a link token. They are meant to be shared, never
    // indexed — a token in a search result is a link nobody chose to hand out.
    robots: "noindex, nofollow",
    // index.html's og:url points at the site root, and inheriting it here sent
    // people who tapped the preview card to https://app.perceptionx.ai — which
    // is the sign-in route, and bounces anyone with a session to the dashboard
    // instead of to the link they were sent. Absent is correct: a client with
    // no og:url uses the URL it actually fetched. activate-meta.ts puts the
    // real per-token URL back.
    dropUrl: true,
  },
];

function applyMeta(html: string, variant: MetaVariant): string {
  const set = (source: string, pattern: RegExp, value: string) =>
    source.replace(pattern, `$1${value}$2`);

  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${variant.title}</title>`);
  out = set(out, /(<meta name="description" content=")[^"]*(")/, variant.description);
  out = set(out, /(<meta property="og:title" content=")[^"]*(")/, variant.title);
  out = set(out, /(<meta property="og:description" content=")[^"]*(")/, variant.description);
  out = set(out, /(<meta name="twitter:title" content=")[^"]*(")/, variant.title);
  out = set(out, /(<meta name="twitter:description" content=")[^"]*(")/, variant.description);
  if (variant.image) {
    out = set(out, /(<meta property="og:image" content=")[^"]*(")/, variant.image);
    out = set(out, /(<meta name="twitter:image" content=")[^"]*(")/, variant.image);
  }
  if (variant.imageAlt) {
    out = set(out, /(<meta property="og:image:alt" content=")[^"]*(")/, variant.imageAlt);
  }
  if (variant.robots) {
    out = set(out, /(<meta name="robots" content=")[^"]*(")/, variant.robots);
    out = set(out, /(<meta name="googlebot" content=")[^"]*(")/, variant.robots);
  }
  if (variant.dropUrl) {
    out = out.replace(/\s*<meta property="og:url" content="[^"]*" \/>/, "");
    out = out.replace(/\s*<link rel="canonical" href="[^"]*" \/>/, "");
  }
  return out;
}

function metaVariantHtml(): Plugin {
  return {
    name: "meta-variant-html",
    apply: "build",
    closeBundle() {
      const distDir = path.resolve(__dirname, "dist");
      const indexPath = path.join(distDir, "index.html");
      if (!fs.existsSync(indexPath)) return;
      const index = fs.readFileSync(indexPath, "utf8");
      for (const variant of META_VARIANTS) {
        fs.writeFileSync(path.join(distDir, variant.file), applyMeta(index, variant));
      }
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
  plugins: [react(), metaVariantHtml()],
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
