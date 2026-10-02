import type { NextConfig } from "next";

/**
 * In GitHub Codespaces the app is reached through a forwarded https://<name>-3000.app.github.dev
 * address. Allow that origin for the dev server and for Server Actions there only; everywhere
 * else the defaults (same origin only) apply.
 */
const codespacesDomain = process.env.CODESPACES === "true" ? (process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? "app.github.dev") : null;

const nextConfig: NextConfig = {
  devIndicators: { position: "bottom-right" },
  ...(codespacesDomain ? { allowedDevOrigins: [`*.${codespacesDomain}`] } : {}),
  experimental: {
    serverActions: {
      // Offer letter templates are up to 5 MB (enforced in the service); leave room for multipart overhead.
      bodySizeLimit: "6mb",
      ...(codespacesDomain ? { allowedOrigins: [`*.${codespacesDomain}`] } : {}),
    },
  },
};

export default nextConfig;
