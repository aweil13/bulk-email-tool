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
  resolve: {
    alias: {
      // Bundle the shared package straight from its TypeScript source.
      // Its compiled dist/index.js re-exports via CommonJS `__exportStar`,
      // which rollup can't statically analyze — a value import like
      // `import { AVAILABLE_LISTS }` fails with "not exported". Pointing at
      // the ESM source sidesteps that. Types still resolve via the package's
      // dist/index.d.ts during `tsc --noEmit`.
      "@bulk-email-tool/shared": resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        unsubscribe: resolve(__dirname, "unsubscribe.html"),
      },
    },
  },
});
