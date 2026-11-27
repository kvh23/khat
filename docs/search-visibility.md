# Khat AI search visibility

The canonical homepage is the public sign-in page at https://khat.khat.workers.dev/. The homepage, its static assets, robots.txt and sitemap.xml are intended for public discovery. The sitemap lists the homepage only. Account APIs still enforce the existing session and owner checks. The robots exclusion for /api/ guides crawlers and is separate from access control.

## Google Search Console verification

1. After the SEO PR is reviewed and deployed, open [Google Search Console](https://search.google.com/search-console/). Select **Add property → URL prefix** and enter `https://khat.khat.workers.dev/` exactly.
2. In **Verify ownership**, select **HTML file** and download the file Google provides, named something like `google1234567890abcdef.html`.
3. Add that exact file, with its original filename and contents, directly under `public/` in the Khat repository. Submit it for review and deploy it with the usual Cloudflare Workers Builds workflow. No placeholder verification token is shipped.
4. While logged out, open `https://khat.khat.workers.dev/<the exact downloaded filename>`. Confirm it returns HTTP 200 and contains the verification text without redirecting to sign-in. Then click **Verify** in Search Console. Leave the file deployed so Google can recheck ownership.
5. In **Sitemaps**, submit `sitemap.xml`. In **URL Inspection**, inspect the canonical homepage and use **Test live URL** to check crawl access, then **Request indexing**. Indexing and when it appears in search are up to Google.

After deployment, fetch the public homepage and check its title, canonical link and lack of an `X-Robots-Tag: noindex` header. Fetch the live robots.txt and sitemap too, since Cloudflare may prepend managed crawler directives. Googlebot must be allowed on the homepage. Check that an anonymous request to /api/workspace still returns 401.
