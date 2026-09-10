import { defineConfig } from "vite";
import { resolve } from "path";

// Static site with 2 pages, served from Cloudflare Pages:
//   index.html        the compose/send tool — gate this with Cloudflare
//                      Access, it's the whole point of restricting the site
//   unsubscribe.html   public — must stay reachable without login, real
//                      recipients land here from an email link
// No signup page: subscribers are loaded via `npm run import-subscribers`
// from a CSV/Excel file, not through a public form.
export default defineConfig({
  base: "/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        unsubscribe: resolve(__dirname, "unsubscribe.html"),
      },
    },
  },
});
