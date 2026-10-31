import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Telegram Mini App is hosted on GitHub Pages as a static site.
  output: "export",
  basePath: "/ethio-music",
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
