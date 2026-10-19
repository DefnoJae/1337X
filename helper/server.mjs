import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function detailPath(value) {
    return typeof value === 'string' && /^\/[a-zA-Z0-9_-]+-\d+\/$/.test(value);
}
export function pagePath(value) {
    if (typeof value !== 'string' || !value.startsWith('/browse/?')) return false;
    const url = new URL(value, 'https://ext.to');
    return url.origin === 'https://ext.to' && url.pathname === '/browse/' && !url.hash && url.searchParams.get('cat') === '7' && url.searchParams.get('with_adult') === '0' && [...url.searchParams.keys()].every(k => ['q','cat','with_adult','sort','order'].includes(k));
}

export function createHelper({ token, loadPage, getMagnet }) {
    let pending = 0;
    let queue = Promise.resolve();
    return http.createServer(async (req, res) => {
        const send = (code, body) => { res.writeHead(code, {'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); };
        // No browser-origin requests or general-purpose URL forwarding.
        if (req.headers.origin || !['127.0.0.1:18731','localhost:18731'].includes(req.headers.host)) return send(403,{error:'Local server requests only'});
        if (req.url === '/health' && req.method === 'GET') return send(200,{ok:true,service:'EXT CloakBrowser helper'});
        if (req.headers.authorization !== 'Bearer ' + token) return send(401,{error:'Helper token is missing or incorrect'});
        if (req.method !== 'POST' || !['/page','/magnet'].includes(req.url)) return send(404,{error:'Unknown endpoint'});
        if (pending >= 4) return send(429,{error:'Helper is busy; retry shortly'});
        let body = '';
        try {
            for await (const chunk of req) { body += chunk; if (body.length > 8192) return send(413,{error:'Request too large'}); }
            const input = JSON.parse(body);
            if (!(req.url === '/page' ? pagePath(input.path) : detailPath(input.path))) return send(400,{error:'Invalid EXT path'});
            pending++;
            const operation = queue.then(() => req.url === '/page' ? loadPage(input.path) : getMagnet(input.path));
            queue = operation.catch(() => {});
            try { const value = await operation; send(200,req.url === '/page' ? {html:value} : {magnet:value}); }
            finally { pending--; }
        } catch (error) { send(502,{error:String(error.message || error)}); }
    });
}

export async function startHelper() {
    const stateDir = path.resolve(process.env.EXT_HELPER_STATE || path.join(root,'.ext-helper'));
    await fs.mkdir(stateDir,{recursive:true});
    const settingsPath = path.join(stateDir,'connection.json');
    let token;
    try { token = JSON.parse(await fs.readFile(settingsPath,'utf8')).token; } catch {}
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) token = crypto.randomBytes(32).toString('hex');
    await fs.writeFile(settingsPath,JSON.stringify({url:'http://127.0.0.1:18731',token},null,2),{mode:0o600});
    // Keep binaries and the dedicated site profile within this workspace.
    process.env.CLOAKBROWSER_CACHE_DIR ||= path.join(stateDir,'browser');
    process.env.CLOAKBROWSER_AUTO_UPDATE = 'false';
    const { launchPersistentContext } = await import('cloakbrowser');
    let context;
    let page;
    async function getPage() {
        if (!context) {
            context = await launchPersistentContext({userDataDir:path.join(stateDir,'profile'),headless:false});
            context.on('close',()=> {context=undefined;page=undefined;});
        }
        if (!page || page.isClosed()) page = await context.newPage();
        return page;
    }
    async function visit(relativePath, detail = false) {
        const tab = await getPage();
        await tab.goto('https://ext.to' + relativePath,{waitUntil:'domcontentloaded',timeout:45000});
        await tab.waitForFunction(isDetail => isDetail
            ? !!(window.pageToken || document.querySelector('a[href^="magnet:?"]'))
            : !!document.querySelector('table.search-table') || /no results|nothing found|no torrents|no records/i.test(document.body?.innerText || ''),detail,{timeout:100000});
        if (new URL(tab.url()).origin !== 'https://ext.to') throw new Error('Unexpected EXT redirect');
        return tab;
    }
    const server = createHelper({ token,
        loadPage: async relativePath => (await visit(relativePath)).content(),
        getMagnet: async relativePath => {
            const tab = await visit(relativePath,true);
            const magnet = await tab.evaluate(async () => {
                const existing = document.querySelector('a[href^="magnet:?"]');
                if (existing) return existing.getAttribute('href');
                const id = location.pathname.match(/-(\d+)\/$/)[1];
                if (!window.pageToken || !window.csrfToken) throw new Error('EXT page tokens missing');
                const timestamp = String(Math.floor(Date.now()/1000));
                const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id+'|'+timestamp+'|'+window.pageToken));
                const hmac = Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
                const response = await fetch('/ajax/getTorrentMagnet.php',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest'},body:new URLSearchParams({torrent_id:id,action:'get_magnet',timestamp,hmac,sessid:window.csrfToken}).toString()});
                if (!response.ok) throw new Error('EXT magnet HTTP '+response.status);
                const data = await response.json();
                if (!data.success || !data.magnet) throw new Error(data.error || 'EXT returned no magnet');
                return data.magnet;
            });
            if (!/^magnet:\?[^\s]*\bxt=urn:btih:(?:[a-f0-9]{40}|[a-z2-7]{32})(?:&|$)/i.test(magnet)) throw new Error('EXT returned an invalid magnet');
            return magnet;
        }
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(18731,'127.0.0.1',resolve);});
    console.log('EXT helper ready at http://127.0.0.1:18731. Connection settings: '+settingsPath);
    const close = async () => { server.close(); if (context) await context.close(); };
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>close().finally(()=>process.exit(0)));
    return {server,close};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startHelper().catch(error=>{console.error(error.message);process.exitCode=1;});
