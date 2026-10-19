# EXT Torrents for Seanime

<img src="assets/logo.png" width="100" alt="Original uploaded red X logo">

Anime torrent provider for https://ext.to/: sub, dub, dual audio, episodes, batches, resolution filters, latest releases and magnet/info-hash retrieval.

## Install or update

In Seanime Extensions, add this manifest URL:

https://raw.githubusercontent.com/DefnoJae/1337X/main/Manifest.json

Existing users: update the installed extension. Version 2.0.0 replaces 1337x with EXT Torrents. The ID `defnojae1337x` and repository URL remain unchanged so existing installations can update. No requests go to 1337x. The original uploaded red X PNG is preserved unchanged.

## Search

Queries use EXT's `/browse/` endpoint, anime category `7`, and `with_adult=0`. All audio variants are included; add `dub`, `sub` or `dual audio` to your custom query to narrow results. Smart search tries English and Romaji titles, deduplicates, and filters episodes, batches and resolution. One results page is read per title. Matches are title-based, not verified AniDB matches.

Episode forms include `S01E03`, `E03`, `Episode 3` and ` - 03`. Packs include explicit ranges, complete collections and season packs. Episode searches exclude packs; batch searches require identifiable packs. Unknown episode names remain in regular search. Season offsets are not inferred.

Static magnets are read directly when present. Otherwise Chrome loads the detail page and requests EXT's magnet endpoint using that same browser session's page tokens and cookies. The provider returns a magnet URI without starting a download or opening a torrent client.

## Browser verification

EXT can return Cloudflare verification pages, including HTTP 403. The provider uses Seanime ChromeDP as a fallback. Install Chrome/Chromium on the machine running the Seanime server. The default is a visible browser and a 60-second timeout; complete any verification yourself in that browser. Your regular browser uses a separate session. Browser sessions close after completion or failure.

Extension configuration supports headless mode for servers without a display, and timeouts from 30 to 120 seconds. Verification can still prevent scraping. Changing the source does not guarantee availability. Failures are reported rather than returned as empty results.

## Validation

Run `npm ci`, `npm run check` and `npm test`. Tests use fixtures and mocks; they do not download torrents.

Live migration checks: EXT's homepage loaded in the browser, and its anime navigation resolved to category 7. Direct requests and browser search requests encountered Cloudflare verification. Successful live search and magnet resolution have not been established on this network.

Protocol reference: [EXT Torznab integration](https://github.com/huseyincig/extto-torznab-proxy/blob/main/server.js). This is an independent Seanime implementation and does not require that service.
