/**
 * WHERE THE BOARD LIVES. Staff reach it at sasquatchpestcontrol.com/office/.
 * The public website (a static Astro site) forwards that one path here with a
 * Vercel rewrite, so the address bar never shows a vercel.app name.
 *
 * Next adds this prefix to pages, links and its own assets by itself, but NOT
 * to fetch() calls or window.location. Those go through api() and BASE.
 * Change it here and in next.config.mjs together, and update the rewrite in
 * the website's vercel.json.
 */
export const BASE = "/office";

// Trailing slash on purpose. The website redirects every slashless path to
// its slashed form, and a redirected POST is one more round trip.
export function api(path) {
  return `${BASE}/api/${path.replace(/^\/+/, "").replace(/\/?$/, "/")}`;
}
