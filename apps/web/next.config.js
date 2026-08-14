const path = require("path");

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",

  experimental: {
    outputFileTracingRoot: path.join(__dirname, "../..")
  },

  async headers() {
    return [
      {
        source: "/login",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups"
          }
        ]
      }
    ];
  },

  eslint: {
    ignoreDuringBuilds: true
  },

  typescript: {
    ignoreBuildErrors: false
  }
};

module.exports = nextConfig;
