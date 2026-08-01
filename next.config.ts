import type { NextConfig } from "next";
import path from "path";

const NO_STORE_HEADERS = [
  { key: "Cache-Control", value: "private, no-cache, no-store, max-age=0, must-revalidate" },
  { key: "Pragma", value: "no-cache" },
  { key: "Expires", value: "0" },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    return [
      { source: "/:path*", headers: NO_STORE_HEADERS },
      { source: "/api/:path*", headers: NO_STORE_HEADERS },
    ];
  },
};

export default nextConfig;
