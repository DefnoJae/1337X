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

### Local CloakBrowser helper (version 2.1.0)

Version 2.1.2 restores the separate CloakBrowser helper as the default. Existing installations with an explicitly saved browser mode should select **Local CloakBrowser helper** in preferences. Stock Chrome remains an explicit optional mode.

Install Node.js 20.19+ and run `npm ci`, then `npm run helper` from this repository on the **same machine as the Seanime server**. The first search downloads the free CloakBrowser Chromium binary into `.ext-helper/browser/` and verifies its published checksum. A visible browser uses a dedicated persistent profile in `.ext-helper/profile/`. This is separate from your regular Chrome profile.

In Seanime, update EXT Torrents, open its configuration, choose **Local CloakBrowser helper**, and copy the `token` value from `.ext-helper/connection.json` into **Local helper token**. Keep the helper running while using this mode. Stop it with Ctrl+C. It does not install a startup task or run as a Windows service.

The helper binds only to `127.0.0.1:18731`, authenticates page/magnet requests, rejects browser-origin requests, allows only EXT anime browse and release-detail paths, and serializes work in one browser session. Do not publish its token, connection file, or profile. These files and binaries are ignored by Git. No third-party proxy or paid license is configured.

Live verification: the free Windows CloakBrowser binary loaded a Death Note search, the provider parsed **50 releases**, and it retrieved a valid magnet and 40-character info hash from one release. No torrent download was started. Site verification can change; this is a successful observed test, not a guarantee of future access.

EXT can return Cloudflare verification pages, including HTTP 403. The provider uses Seanime ChromeDP as a fallback. Install Chrome/Chromium on the machine running the Seanime server. The default is a visible browser and a 60-second timeout; complete any verification yourself in that browser. Your regular browser uses a separate session. Browser sessions close after completion or failure.

Extension configuration supports headless mode for servers without a display, and timeouts from 30 to 120 seconds. Verification can still prevent scraping. Changing the source does not guarantee availability. Failures are reported rather than returned as empty results.

## Validation

Run `npm ci`, `npm run check` and `npm test`. Tests use fixtures and mocks; they do not download torrents.

Earlier direct-fetch and stock-Chrome tests encountered Cloudflare verification. The local CloakBrowser helper subsequently passed the live search and magnet smoke test described above. Run `node helper/probe.mjs` while the helper is running to repeat that smoke test; it returns metadata and a magnet without downloading torrent content.

Protocol reference: [EXT Torznab integration](https://github.com/huseyincig/extto-torznab-proxy/blob/main/server.js). This is an independent Seanime implementation and does not require that service.
