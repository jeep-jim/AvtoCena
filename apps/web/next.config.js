const path = require("path");

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",

  experimental: {
    // Yandex forwards its internal container host; accept only our public origins.
    serverActions: { allowedOrigins: ["avtocena.com", "www.avtocena.com"] },
    outputFileTracingRoot: path.join(__dirname, "../..")
  },

  async headers() {
    return [
      ...["/crm/:path*", "/api/crm/:path*", "/api/leads", "/api/auth/:path*", "/login"].map(source => ({ source, headers: [{key: "X-Robots-Tag", value: "noindex, nofollow, noarchive"}] })),
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
