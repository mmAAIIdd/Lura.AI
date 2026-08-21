import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  /* Docker packaging, not a build mode every target wants: the Dockerfile is
     the only thing that consumes .next/standalone, and it asks for this
     explicitly. Left on unconditionally it made `npm run build` fail outright
     on Windows — the copy step cannot reproduce the tree under a path with
     non-ASCII segments — and put a step in front of Vercel that nothing there
     reads. */
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
  outputFileTracingRoot: process.cwd(),
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
