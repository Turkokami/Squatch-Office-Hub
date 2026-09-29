/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg"],
  /* Served at sasquatchpestcontrol.com/office/ through the website's rewrite.
     See lib/base.js. The website adds a slash to every path before its
     rewrite sees it. If Next then redirected /x/ back to /x, the two would
     bounce a request forever. So Next accepts both forms and redirects
     neither. (`trailingSlash: true` would do the same job, but with basePath
     it serves the board's root as an empty page. Tested; don't.) */
  basePath: "/office",
  skipTrailingSlashRedirect: true,
  async headers() {
    return [
      {
        // Staff-only. The website's robots.txt must allow everything (see its
        // GUARDRAILS.md), so the board keeps itself out of search with this.
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
