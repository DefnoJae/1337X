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
        find: s => wrap(selection.find(s)), first: () => wrap(selection.first()), eq: i => wrap(selection.eq(i)),
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
    return `<tr><td><a href='/anime/'>Anime</a><a class='torrent-title-link' href='/show-${id}/'>${title}</a></td><td>1.5 GB</td><td>video</td><td>2026-10-19</td><td>${seeds}</td><td>3</td></tr>`;
}
const html = '<table class="search-table"><tbody>' + row(1, '[Group] Show - 03 [1080p] [Sub]') + row(2, 'Show S01E03 720p English Dub') + row(3, 'Show 01-12 Complete 1080p Dual Audio') + '</tbody></table>';
test('parses all audio variants, size and episode metadata', async () => {
    const { p, calls } = provider(html);
    const results = await p.search({ query: 'Show & Other', media: {} });
    assert.equal(results.length, 3);
    assert.equal(results[0].size, 1610612736);
    assert.equal(results[0].episodeNumber, 3);
    assert.equal(results[1].episodeNumber, 3);
    assert.equal(results[2].isBatch, true);
    assert.equal(results[0].confirmed, false);
    assert.equal(calls[0], 'https://ext.to/browse/?q=Show+%26+Other&cat=7&with_adult=0');
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
    const torrent = { link: p.base + '/show-1/' };
    assert.equal(await p.getTorrentInfoHash(torrent), hash);
    assert.match(await p.getTorrentMagnetLink(torrent), /&dn=Show$/);
    assert.equal(calls.length, 1);
    assert.equal(await p.getTorrentInfoHash({ magnetLink: 'magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }), '0'.repeat(40));
    await assert.rejects(p.getTorrentMagnetLink({ link: 'https://evil.test/torrent/1/' }), /Invalid/);
});
test('empty results, HTTP failures, challenges and changed layouts are distinct', async () => {
    assert.equal((await provider('<body>No results found</body>').p.getLatest()).length, 0);
    await assert.rejects(provider('blocked', 503).p.getLatest(), /ChromeDP is unavailable/);
    await assert.rejects(provider('<title>Just a moment</title>').p.getLatest(), /verification/);
    await assert.rejects(provider('<body>Unknown page</body>').p.getLatest(), /unexpected/);
    await assert.rejects(provider('<body>No magnet</body>').p.getTorrentMagnetLink({ link: 'https://ext.to/show-1/' }), /requires Seanime ChromeDP/);
});
test('ordinary EXT captcha script references are not mistaken for challenge pages',()=>{
    const {p}=provider('');
    assert.equal(p.isChallenge('<title>Search EXT</title><script src="/captcha.js"></script>'),false);
    assert.equal(p.isChallenge('<title>Just a moment...</title>'),true);
});
test('challenge response retries in Chrome and closes the browser', async () => {
    let closed = 0;
    const context = vm.createContext({ LoadDoc, console,
        fetch: async () => ({ ok: false, status: 403, text: () => '<title>Just a moment</title>' }),
        ChromeDP: { newBrowser: async () => ({ navigate: async () => {}, evaluate: async () => true, outerHTML: async () => html, close: async () => { closed++; } }) }
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
    assert.equal(manifest.id, 'defnojae1337x');
    assert.equal(manifest.name, 'EXT Torrents');
    assert.equal(manifest.website, 'https://ext.to');
});
test('browser defaults to visible; preferences select headless and bound timeout', () => {
    const { p } = provider('');
    assert.equal(p.browserOptions().headless, false);
    assert.equal(p.browserOptions().timeout, 60);
    const preferences = { browserMode: 'headless', browserTimeout: '90' };
    const context = vm.createContext({ $getUserPreference: key => preferences[key] });
    const configured = vm.runInContext(source + ';new Provider()', context);
    assert.equal(configured.browserOptions().headless, true);
    assert.equal(configured.browserOptions().timeout, 90);
    preferences.browserTimeout = '999';
    assert.equal(configured.browserOptions().timeout, 60);
    preferences.browserTimeout = 'invalid';
    assert.equal(configured.browserOptions().timeout, 60);
});
test('token-based magnets use the browser session and correct signature', async () => {
    const crypto = require('node:crypto');
    const hash = 'abcdef0123456789abcdef0123456789abcdef01';
    let closed = 0;
    const context = vm.createContext({ LoadDoc,
        fetch: async () => ({ok:true,status:200,text:()=>'<body>Detail page</body>'}),
        ChromeDP: {newBrowser: async () => ({
            navigate: async url => assert.equal(url, 'https://ext.to/show-123/'),
            evaluate: async () => true,
            executeCDP: async (method, args) => {
                assert.equal(method, 'Runtime.evaluate');
                assert.equal(args.awaitPromise, true);
                const browserContext = vm.createContext({
                    document: {querySelector:()=>null}, location:{pathname:'/show-123/'},
                    window:{pageToken:'page-token',csrfToken:'csrf-token'},
                    crypto:crypto.webcrypto, TextEncoder, URLSearchParams,
                    fetch: async (url, options) => {
                        assert.equal(url, '/ajax/getTorrentMagnet.php');
                        assert.equal(options.credentials, 'same-origin');
                        const body = new URLSearchParams(options.body);
                        assert.equal(body.get('torrent_id'), '123');
                        assert.equal(body.get('sessid'), 'csrf-token');
                        assert.equal(body.get('action'), 'get_magnet');
                        assert.equal(body.get('hmac'), crypto.createHash('sha256').update('123|' + body.get('timestamp') + '|page-token').digest('hex'));
                        return {ok:true,json:async()=>({success:true,magnet:'magnet:?xt=urn:btih:' + hash})};
                    }
                });
                return {result:{value:await vm.runInContext(args.expression,browserContext)}};
            }, close: async () => {closed++;}
        })}
    });
    const p = vm.runInContext(source + ';new Provider()',context);
    assert.equal(await p.getTorrentInfoHash({link:'https://ext.to/show-123/'}),hash);
    assert.equal(closed,1);
});
test('Cloak helper mode routes search and magnets over authenticated loopback',async()=>{
    const calls=[];
    const hash='abcdef0123456789abcdef0123456789abcdef01';
    const context=vm.createContext({LoadDoc,$getUserPreference:key=>({browserMode:'cloak',helperToken:'test-token'}[key]),fetch:async(url,options)=>{
        calls.push({url,options});
        return {ok:true,json:()=>url.endsWith('/page')?{html}:{magnet:'magnet:?xt=urn:btih:'+hash}};
    }});
    const p=vm.runInContext(source+';new Provider()',context);
    assert.equal((await p.search({query:'Show'})).length,3);
    assert.equal(await p.getTorrentInfoHash({link:'https://ext.to/show-123/'}),hash);
    assert.equal(calls.length,2);
    assert.equal(calls[0].url,'http://127.0.0.1:18731/page');
    assert.equal(calls[0].options.headers.Authorization,'Bearer test-token');
    assert.equal(calls[1].url,'http://127.0.0.1:18731/magnet');
});
