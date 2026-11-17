import type { NextConfig } from "next";

// On Render the frontend is a static site and calls the backend directly. Render gives the
// backend's host name in API_HOST (see render.yaml); NEXT_PUBLIC_API_URL can also be set by hand.
const publicApiUrl = process.env.NEXT_PUBLIC_API_URL || (process.env.API_HOST ? `https://${process.env.API_HOST}` : "");
const localApi = process.env.API_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = publicApiUrl
  ? {
      // Hosted: plain HTML/JS files (Render static site), no Next.js server.
      output: "export",
      env: { NEXT_PUBLIC_API_URL: publicApiUrl },
    }
  : {
      experimental: {
        // The default 30 s limit cut long summaries ("socket hang up").
        proxyTimeout: 15 * 60 * 1000,
      },
      // Development: the browser talks only to this site; Next.js forwards /api to the Python backend.
      async rewrites() {
        return [{ source: "/api/:path*", destination: `${localApi}/api/:path*` }];
      },
    };

export default nextConfig;
