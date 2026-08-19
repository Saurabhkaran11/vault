import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
