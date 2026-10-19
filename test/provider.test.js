const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const cheerio = require('cheerio');
const source = fs.readFileSync('provider.js', 'utf8');
// Match Seanime's DocSelection API: each passes selections, length is a method.
function LoadDoc(html) {
    const $ = cheerio.load(html);
    const wrap = selection => ({
        find: s => wrap(selection.find(s)), first: () => wrap(selection.first()),
        text: () => selection.text(), attr: k => selection.attr(k), length: () => selection.length,
        each: cb => selection.each((i, node) => cb(i, wrap($(node))))
    });
    return s => wrap($(s));
}
function provider(html, status = 200) {
    const calls = [];
    const context = vm.createContext({ LoadDoc, fetch: async url => { calls.push(url); return { ok: status === 200, status, text: async () => html }; } });
    return { p: vm.runInContext(source + ';new Provider()', context), calls };
}
function row(id, title, seeds = 20) {
    return `<tr><td><a href='/category/Anime/'>Anime</a><a href='/torrent/${id}/title/'>${title}</a></td><td class='seeds'>${seeds}</td><td class='leeches'>3</td><td class='size'>1.5 GB<span>uploader</span></td></tr>`;
}
const html = '<table><tbody>' + row(1, '[Group] Show - 03 [1080p] [Sub]') + row(2, 'Show S01E03 720p English Dub') + row(3, 'Show 01-12 Complete 1080p Dual Audio') + '</tbody></table>';
test('parses all audio variants, size and episode metadata', async () => {
    const { p, calls } = provider(html);
    const results = await p.search({ query: 'Show & Other', media: {} });
    assert.equal(results.length, 3);
    assert.equal(results[0].size, 1610612736);
    assert.equal(results[0].episodeNumber, 3);
    assert.equal(results[1].episodeNumber, 3);
    assert.equal(results[2].isBatch, true);
    assert.equal(results[0].confirmed, false);
    assert.match(calls[0], /Show%20%26%20Other\/Anime\/1\/$/);
});
test('smart search filters episodes, batches and resolution and deduplicates aliases', async () => {
    const { p } = provider(html);
    const opts = { media: { englishTitle: 'Show', romajiTitle: 'Other' }, query: '', batch: false, episodeNumber: 3, resolution: '1080p' };
    assert.equal((await p.smartSearch(opts)).length, 1);
    const batches = await p.smartSearch({ ...opts, batch: true });
    assert.equal(batches.length, 1);
    assert.equal(batches[0].isBatch, true);
    assert.equal(p.metadata('Show 1920-1080 2024').isBatch, false);
    assert.equal(p.metadata('Show - 12v2 [720p]').episodeNumber, 12);
});
test('magnet extraction decodes HTML entities and caches detail fetch', async () => {
    const hash = 'abcdef0123456789abcdef0123456789abcdef01';
    const { p, calls } = provider(`<a href='magnet:?xt=urn:btih:${hash}&amp;dn=Show'>Magnet</a>`);
    const torrent = { link: p.base + '/torrent/1/show/' };
    assert.equal(await p.getTorrentInfoHash(torrent), hash);
    assert.match(await p.getTorrentMagnetLink(torrent), /&dn=Show$/);
    assert.equal(calls.length, 1);
    assert.equal(await p.getTorrentInfoHash({ magnetLink: 'magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }), '0'.repeat(40));
    await assert.rejects(p.getTorrentMagnetLink({ link: 'https://evil.test/torrent/1/' }), /Invalid/);
});
test('empty results, HTTP failures, challenges and changed layouts are distinct', async () => {
    assert.equal((await provider('<body>No results found</body>').p.getLatest()).length, 0);
    await assert.rejects(provider('blocked', 503).p.getLatest(), /ChromeDP is unavailable/);
    await assert.rejects(provider('<body>Just a moment</body>').p.getLatest(), /verification/);
    await assert.rejects(provider('<body>Unknown page</body>').p.getLatest(), /unexpected/);
    await assert.rejects(provider('<body>No magnet</body>').p.getTorrentMagnetLink({ link: 'https://1337x.to/torrent/1/x/' }), /No valid magnet/);
});
test('challenge response retries in Chrome and closes the browser', async () => {
    let closed = 0;
    const context = vm.createContext({ LoadDoc, console,
        fetch: async () => ({ ok: false, status: 403, text: () => '<title>Just a moment</title>' }),
        ChromeDP: { newBrowser: async () => ({ navigate: async () => {}, waitVisible: async () => {}, outerHTML: async () => html, close: async () => { closed++; } }) }
    });
    const p = vm.runInContext(source + ';new Provider()', context);
    assert.equal((await p.search({ query: 'Show' })).length, 3);
    assert.equal(closed, 1);
    context.ChromeDP.newBrowser = async () => ({ navigate: async () => { throw new Error('navigation failed'); }, close: async () => { closed++; } });
    await assert.rejects(p.getLatest(), /navigation failed/);
    assert.equal(closed, 2);
});
test('manifest points to shipped payload and original logo', () => {
    const manifest = JSON.parse(fs.readFileSync('Manifest.json'));
    assert.equal(manifest.type, 'anime-torrent-provider');
    assert.ok(manifest.payloadURI.endsWith('/main/provider.js'));
    assert.ok(fs.existsSync('assets/logo.png'));
});
