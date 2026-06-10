import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Ensure the ffmpeg binary + caption font are bundled into the finalize
  // serverless function (used to burn the on-screen text overlay).
  outputFileTracingIncludes: {
    "/api/studio/finalize": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./src/assets/fonts/Roboto-Bold.ttf",
    ],
  },
};

export default nextConfig;
