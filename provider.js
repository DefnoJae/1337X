// Seanime supplies fetch and LoadDoc. No browser or Node APIs are required.
class Provider {
    base = "https://ext.to";

    helperEnabled() {
        const mode = typeof $getUserPreference === "function" ? $getUserPreference("browserMode") : "";
        // Keep the separately launched CloakBrowser as the default browser.
        return !mode || mode === "cloak";
    }

    async helperRequest(endpoint, path) {
        const token = $getUserPreference("helperToken") || "";
        if (!token) throw new Error("Set the local CloakBrowser helper token in EXT Torrents configuration.");
        const response = await fetch("http://127.0.0.1:18731" + endpoint, {
            method: "POST", timeout: 180,
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
            body: JSON.stringify({path})
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Local EXT helper HTTP " + response.status);
        return data;
    }

    getSettings() {
        return { canSmartSearch: true, smartSearchFilters: ["query", "batch", "episodeNumber", "resolution"], supportsAdult: false, type: "main" };
    }

    async page(path) {
        if (this.helperEnabled()) return LoadDoc((await this.helperRequest("/page", path)).html);
        const url = this.base + path;
        try {
            const response = await fetch(url);
            const html = await response.text();
            if (this.isChallenge(html) || response.status === 403 || response.status === 503) {
                console.warn("EXT.to: HTTP " + response.status + "; trying Seanime Chrome browser for " + url);
                return LoadDoc(await this.browserPage(url, path));
            }
            if (!response.ok) throw new Error("HTTP " + response.status);
            return LoadDoc(html);
        } catch (error) {
            const message = "EXT.to could not load " + url + ": " + String(error);
            console.error(message);
            throw new Error(message);
        }
    }

    isChallenge(html) {
        return /<title[^>]*>\s*(?:Just a moment|Attention Required)/i.test(html) || /id=["']challenge-(?:running|stage)["']/i.test(html);
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
            console.log("EXT.to: starting " + (options.headless ? "headless" : "visible") + " Chrome; timeout=" + options.timeout + "s");
            browser = await ChromeDP.newBrowser(options);
            await browser.navigate(url);
            await this.waitForContent(browser);
            const html = await browser.outerHTML("html");
            if (this.isChallenge(html)) throw new Error("Browser verification is still required");
            return html;
        } catch (error) {
            throw new Error("Chrome did not reach the expected EXT.to page. In this extension's configuration, select Visible browser and retry; complete any verification in the Chrome window Seanime opens. A normal Chrome tab uses a separate session. If no window opens, check Chrome installation on the Seanime server. " + String(error));
        } finally {
            if (browser) await browser.close();
        }
    }

    async waitForContent(browser) {
        const deadline = Date.now() + (this.browserOptions().timeout - 5) * 1000;
        while (Date.now() < deadline) {
            const ready = await browser.evaluate(`!!(document.querySelector('table.search-table, a[href^="magnet:?"]') || window.pageToken || /no results|nothing found|no torrents|no records/i.test(document.body ? document.body.innerText : ''))`);
            if (ready) return;
            await browser.sleep(500);
        }
        throw new Error("EXT.to verification did not finish before the timeout");
    }

    async search(opts) {
        const query = (opts.query || "").trim();
        if (!query || (opts.media && opts.media.isAdult)) return [];
        return this.list("/browse/?q=" + encodeURIComponent(query).replace(/%20/g, "+") + "&cat=7&with_adult=0");
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
        $("table.search-table tr").each((i, row) => {
            const anchor = row.find('a.torrent-title-link').first();
            const href = anchor.attr("href");
            const name = anchor.text().trim();
            if (!href || !name) return;
            const link = href.indexOf(this.base + "/") === 0 ? href : /^\/(?!\/)[^?#]+-\d+\/?$/.test(href) ? this.base + href : "";
            if (!link || !/-\d+\/?$/.test(link)) return;
            const cells = row.find("td");
            const number = index => +(cells.eq(index).text().replace(/[^\d]/g, "")) || 0;
            const rawDate = cells.eq(3).text().trim();
            const parsedDate = Date.parse(rawDate);
            results.push(Object.assign({ name, date: isNaN(parsedDate) ? "" : new Date(parsedDate).toISOString(), size: this.sizeBytes(cells.eq(1).text()), formattedSize: "", seeders: number(4), leechers: number(5), downloadCount: 0, link, isBestRelease: false, confirmed: false }, this.metadata(name)));
        });
        if (!results.length && !/no results|nothing found|no torrents|no records/i.test($("body").text()) && !$("table.search-table").length()) {
            throw new Error("EXT.to returned an unexpected page; the site may be unavailable or its layout changed.");
        }
        return results;
    }

    async getLatest() { return this.list("/browse/?cat=7&sort=age&order=desc&with_adult=0"); }

    async getTorrentMagnetLink(torrent) {
        if (torrent.magnetLink) return torrent.magnetLink;
        // Only request detail pages on the configured origin.
        if (!torrent.link || torrent.link.indexOf(this.base + "/") !== 0 || !/^\/(?!\/)[^?#]+-\d+\/?$/.test(torrent.link.slice(this.base.length))) throw new Error("Invalid EXT.to detail URL");
        if (this.helperEnabled()) {
            const data = await this.helperRequest("/magnet", torrent.link.slice(this.base.length));
            if (!data.magnet || !/[?&]xt=urn:btih:([a-f0-9]{40}|[a-z2-7]{32})(?:&|$)/i.test(data.magnet)) throw new Error("Local EXT helper returned an invalid magnet");
            torrent.magnetLink = data.magnet;
            return data.magnet;
        }
        const $ = await this.page(torrent.link.slice(this.base.length));
        let magnet = $('a[href^="magnet:?"]').first().attr("href");
        if (!magnet) magnet = await this.resolveMagnetInBrowser(torrent.link);
        if (!magnet || !/[?&]xt=urn:btih:([a-f0-9]{40}|[a-z2-7]{32})(?:&|$)/i.test(magnet)) throw new Error("No valid magnet link found on EXT.to detail page");
        torrent.magnetLink = magnet;
        return magnet;
    }

    async resolveMagnetInBrowser(url) {
        if (typeof ChromeDP === "undefined") throw new Error("EXT.to magnet resolution requires Seanime ChromeDP and Chrome/Chromium.");
        let browser;
        try {
            browser = await ChromeDP.newBrowser(this.browserOptions());
            await browser.navigate(url);
            await this.waitForContent(browser);
            // EXT's endpoint needs page tokens and cookies from this same session.
            const expression = `(async () => {
                const existing = document.querySelector('a[href^="magnet:?"]');
                if (existing) return existing.getAttribute('href');
                const id = location.pathname.match(/-(\\d+)\\/?$/);
                if (!id || !window.pageToken || !window.csrfToken) throw new Error('EXT magnet page tokens missing; verification may be incomplete');
                const timestamp = String(Math.floor(Date.now() / 1000));
                const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id[1] + '|' + timestamp + '|' + window.pageToken));
                const hmac = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
                const response = await fetch('/ajax/getTorrentMagnet.php', {
                    method: 'POST', credentials: 'same-origin',
                    headers: {'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest'},
                    body: new URLSearchParams({torrent_id:id[1],action:'get_magnet',timestamp,hmac,sessid:window.csrfToken}).toString()
                });
                if (!response.ok) throw new Error('EXT magnet HTTP ' + response.status);
                const data = await response.json();
                if (!data.success || !data.magnet) throw new Error(data.error || 'EXT did not return a magnet');
                return data.magnet;
            })()`;
            const response = await browser.executeCDP("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
            if (response.exceptionDetails) throw new Error("EXT magnet request failed: " + JSON.stringify(response.exceptionDetails));
            return response.result && response.result.value || "";
        } finally {
            if (browser) await browser.close();
        }
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
