import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Telegram Mini App is hosted on GitHub Pages as a static site.
  output: "export",
  basePath: "/ethio-music",
  // GitHub Pages serves /route/ only when route/index.html exists
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
