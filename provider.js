// Seanime supplies fetch and LoadDoc. No browser or Node APIs are required.
class Provider {
    base = "https://1337x.to";

    getSettings() {
        return { canSmartSearch: true, smartSearchFilters: ["query", "batch", "episodeNumber", "resolution"], supportsAdult: false, type: "main" };
    }

    async page(path) {
        const url = this.base + path;
        try {
            const response = await fetch(url);
            const html = await response.text();
            if (this.isChallenge(html) || response.status === 403 || response.status === 503) {
                console.warn("1337x: HTTP " + response.status + "; trying Seanime Chrome browser for " + url);
                return LoadDoc(await this.browserPage(url, path));
            }
            if (!response.ok) throw new Error("HTTP " + response.status);
            return LoadDoc(html);
        } catch (error) {
            const message = "1337x could not load " + url + ": " + String(error);
            console.error(message);
            throw new Error(message);
        }
    }

    isChallenge(html) {
        return /cf-chl-|Just a moment|Attention Required|captcha/i.test(html);
    }

    browserOptions() {
        const preference = name => typeof $getUserPreference === "function" ? $getUserPreference(name) : "";
        const requested = Number(preference("browserTimeout"));
        return {
            headless: String(preference("browserMode")) === "headless",
            timeout: requested >= 30 && requested <= 120 ? requested : 60
        };
    }

    async browserPage(url, path) {
        if (typeof ChromeDP === "undefined") throw new Error("Browser verification required, but ChromeDP is unavailable. Install Chrome/Chromium on the Seanime server and retry.");
        let browser;
        try {
            const options = this.browserOptions();
            console.log("1337x: starting " + (options.headless ? "headless" : "visible") + " Chrome; timeout=" + options.timeout + "s");
            browser = await ChromeDP.newBrowser(options);
            await browser.navigate(url);
            await browser.waitVisible(path.indexOf("/torrent/") === 0 ? 'a[href^="magnet:?"]' : "table.table-list, .box-info");
            const html = await browser.outerHTML("html");
            if (this.isChallenge(html)) throw new Error("Browser verification is still required");
            return html;
        } catch (error) {
            throw new Error("Chrome did not reach the expected 1337x page. In this extension's configuration, select Visible browser and retry; complete any verification in the Chrome window Seanime opens. A normal Chrome tab uses a separate session. If no window opens, check Chrome installation on the Seanime server. " + String(error));
        } finally {
            if (browser) await browser.close();
        }
    }

    async search(opts) {
        const query = (opts.query || "").trim();
        if (!query || (opts.media && opts.media.isAdult)) return [];
        return this.list("/category-search/" + encodeURIComponent(query) + "/Anime/1/");
    }

    async smartSearch(opts) {
        if (opts.media && opts.media.isAdult) return [];
        const titles = opts.query ? [opts.query] : [opts.media.englishTitle, opts.media.romajiTitle];
        const seen = {};
        const results = [];
        for (const title of titles.filter((t, i, a) => t && a.indexOf(t) === i)) {
            const torrents = await this.search({ query: title, media: opts.media });
            for (const torrent of torrents) {
                if (seen[torrent.link]) continue;
                seen[torrent.link] = true;
                if (opts.resolution && torrent.resolution !== opts.resolution.replace(/p$/i, "") + "p") continue;
                if (opts.batch && !torrent.isBatch) continue;
                if (!opts.batch && opts.episodeNumber > 0) {
                    // Packs remain discoverable through the explicit batch filter.
                    if (torrent.isBatch || torrent.episodeNumber !== opts.episodeNumber) continue;
                }
                results.push(torrent);
            }
        }
        return results.sort((a, b) => b.seeders - a.seeders);
    }

    metadata(name) {
        const range = /\b(?:S\d{1,2})?E?(\d{1,4})\s*[-~]\s*E?(\d{1,4})\b/i.exec(name);
        const isRange = !!range && +range[1] < +range[2] && +range[2] < 1900;
        const isBatch = isRange || /\b(batch|complete|collection|season\s*\d+)\b/i.test(name) || (/\bS\d{1,2}\b/i.test(name) && !/\bS\d{1,2}E\d+/i.test(name));
        const episode = /\bS\d{1,2}E(\d{1,4})\b/i.exec(name)
            || /\b(?:EP?|episode)\s*0*(\d{1,4})(?:v\d+)?\b/i.exec(name)
            || /\s-\s(\d{1,4})(?:v\d+)?(?:\s|\[|\(|$)/i.exec(name);
        const resolution = /\b(480|720|1080|1440|2160)p\b/i.exec(name);
        return { isBatch, episodeNumber: !isBatch && episode ? +episode[1] : -1, resolution: resolution ? resolution[1] + "p" : "" };
    }

    sizeBytes(text) {
        const match = /([\d.]+)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|TB|B)/i.exec(text);
        if (!match) return 0;
        const unit = match[2].toUpperCase();
        const power = { B: 0, KB: 1, KIB: 1, MB: 2, MIB: 2, GB: 3, GIB: 3, TB: 4, TIB: 4 }[unit];
        return Math.round(+match[1] * Math.pow(1024, power));
    }

    async list(path) {
        const $ = await this.page(path);
        const results = [];
        $("table tbody tr").each((i, row) => {
            const anchor = row.find('a[href^="/torrent/"]').first();
            const href = anchor.attr("href");
            const name = anchor.text().trim();
            if (!href || !name) return;
            const number = selector => +(row.find(selector).text().replace(/[^\d]/g, "")) || 0;
            results.push(Object.assign({ name, date: "", size: this.sizeBytes(row.find("td.size").text()), formattedSize: "", seeders: number("td.seeds"), leechers: number("td.leeches"), downloadCount: 0, link: this.base + href, isBestRelease: false, confirmed: false }, this.metadata(name)));
        });
        if (!results.length && !/no results|nothing found|no torrents/i.test($("body").text()) && !$("table").length()) {
            throw new Error("1337x returned an unexpected page; the site may be unavailable or its layout changed.");
        }
        return results;
    }

    async getLatest() { return this.list("/anime/"); }

    async getTorrentMagnetLink(torrent) {
        if (torrent.magnetLink) return torrent.magnetLink;
        // Only request detail pages on the configured origin.
        if (torrent.link.indexOf(this.base + "/torrent/") !== 0) throw new Error("Invalid 1337x detail URL");
        const $ = await this.page(torrent.link.slice(this.base.length));
        const magnet = $('a[href^="magnet:?"]').first().attr("href");
        if (!magnet || !/[?&]xt=urn:btih:([a-f0-9]{40}|[a-z2-7]{32})(?:&|$)/i.test(magnet)) throw new Error("No valid magnet link found on 1337x detail page");
        torrent.magnetLink = magnet;
        return magnet;
    }

    async getTorrentInfoHash(torrent) {
        if (torrent.infoHash) return torrent.infoHash;
        const magnet = await this.getTorrentMagnetLink(torrent);
        const hash = /[?&]xt=urn:btih:([^&]+)/i.exec(magnet)[1];
        if (hash.length === 40) return hash.toLowerCase();
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        let bits = 0, value = 0, hex = "";
        for (const character of hash.toUpperCase()) {
            value = (value << 5) | alphabet.indexOf(character);
            bits += 5;
            if (bits >= 8) { bits -= 8; hex += ("0" + ((value >>> bits) & 255).toString(16)).slice(-2); }
        }
        return hex;
    }
}
