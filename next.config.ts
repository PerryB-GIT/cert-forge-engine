import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Guide PDFs for /api/guide/[code] are copied into the image by the
  // Dockerfile under ASCII names - not traced here.
};

export default nextConfig;
