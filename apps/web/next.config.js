const path = require("path");

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),

  experimental: {
    // Yandex forwards its internal container host; accept only our public origins.
    serverActions: { allowedOrigins: ["avtocena.com", "www.avtocena.com"] }
  },

  async headers() {
    return [
      {source: "/:path*", headers: [{key:"X-Content-Type-Options",value:"nosniff"},{key:"Referrer-Policy",value:"strict-origin-when-cross-origin"}]},
      ...["/crm/:path*", "/login"].map(source => ({source, headers: [{key:"X-Frame-Options",value:"DENY"},{key:"Content-Security-Policy",value:"frame-ancestors 'none'; object-src 'none'; base-uri 'self'"}]})),
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
