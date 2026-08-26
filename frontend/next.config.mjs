import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const isDev = process.env.NODE_ENV !== "production";

/* Content-Security-Policy, tuned to what Vault actually loads.
 *
 * Deliberately NOT locked down on connect-src/img-src: the "bring your own AI
 * model" feature lets a user point at any endpoint — Anthropic, Gemini, a
 * self-hosted server, local Ollama — so an allowlist there would break the
 * product. The high-value directives are still strict: no plugins
 * (object-src), no clickjacking (frame-ancestors), no <base> hijack
 * (base-uri), and script/frame origins are whitelisted.
 *
 * 'unsafe-inline' on script-src is required because Next injects inline
 * bootstrap scripts and this app has no nonce pipeline; 'unsafe-eval' is dev
 * only (the webpack dev runtime needs it, production does not). The Clerk
 * domains cover development instances (*.clerk.accounts.dev); a production
 * instance on a custom domain must add its own clerk.<domain> here. */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  /* 'wasm-unsafe-eval' admits WebAssembly ONLY (not JS eval) — needed by the
   * local OCR engine (tesseract, served from /ocr/ on our own origin) */
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""} https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com`,
  // 'self' + any https (AI providers, the backend API, Clerk) + localhost and
  // websockets for local Ollama and dev HMR.
  "connect-src 'self' https: http://localhost:* ws://localhost:* wss:",
  "frame-src 'self' https://www.youtube.com https://*.clerk.accounts.dev https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  // HSTS is inert over plain http (localhost) and enforced once served over
  // https (Vercel), so it is safe to send everywhere.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // A vestigial Vite package-lock.json sits at the repo root; without this
  // Next infers that as the workspace root and warns on every build.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      // @anthropic-ai/sdk imports node:fs/os/path for server-side credential
      // resolution; in the browser those paths are never executed. Strip the
      // node: scheme and stub the built-ins for client bundles.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, "");
        })
      );
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false, os: false, path: false, crypto: false,
        stream: false, child_process: false, net: false, tls: false,
      };
    }
    return config;
  },
};

export default nextConfig;
