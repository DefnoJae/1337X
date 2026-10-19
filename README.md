# 1337x for Seanime

<img src="assets/logo.png" width="100" alt="Original uploaded red X logo">

Anime torrent provider with subbed, dubbed and dual-audio releases, episode searches, batches, resolution filtering and magnet/info-hash retrieval.

## Install

In Seanime, open **Extensions**, choose to add an extension, and paste this manifest URL:

https://raw.githubusercontent.com/DefnoJae/1337X/main/Manifest.json

## Search

Search queries use 1337x's Anime category. All audio variants are included; add `dub`, `sub` or `dual audio` to your query to narrow results using the site's search. Smart search tries the English and Romaji titles, deduplicates results, and filters episode numbers, batches and resolution. Episode forms include `S01E03`, `E03`, `Episode 3` and ` - 03`; batches include ranges, complete collections and season packs. Titles without clear episode metadata remain visible in regular search.

Batch searches return explicitly identifiable packs. Episode searches exclude packs. Results are title matches, not verified AniDB matches. Search currently reads the first results page per title; use a narrower custom query for crowded results. Season offsets and ambiguous episode names are not inferred. Latest releases use the anime listing.

The original uploaded red X PNG is preserved unchanged in `assets/logo.png`.

## Development

### Browser timeouts / verification

Version 1.0.2 defaults to a **visible** fallback browser with a 60-second timeout. If prompted, complete verification yourself in the Chrome window opened by Seanime. Your existing Chrome tab has a separate session and does not clear verification for the provider. The browser closes when scraping completes or fails. This requires an interactive desktop on the Seanime server. In the extension configuration, choose **Headless browser** for servers without a display, and set a timeout between 30 and 120 seconds as needed. Verification may still prevent scraping; this is not a guaranteed workaround for site restrictions.

Run `npm ci`, `npm run check` and `npm test`. Tests use HTML fixtures with an adapter matching Seanime's documented `LoadDoc` API; no torrents are downloaded. In Seanime's extension playground, select Anime Torrent Provider, paste `provider.js`, and exercise search, smartSearch, getLatest and both magnet methods.

1337x availability and browser verification vary by network. On HTTP 403/503 or verification pages, the provider retries using Seanime's ChromeDP browser support. Install Chrome/Chromium on the machine running the Seanime server to enable this fallback. Browser sessions are closed after every attempt. If verification persists, the provider reports an actionable error and logs the URL and cause. Other HTTP failures and unexpected layouts also produce explicit errors. A real Seanime playground check is needed to confirm operation on your network.
