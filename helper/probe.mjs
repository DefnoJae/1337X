// Explicit manual smoke test; no downloads are started.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { load } from 'cheerio';
const settings=JSON.parse(await fs.readFile('.ext-helper/connection.json','utf8'));
const source=await fs.readFile('provider.js','utf8');
const LoadDoc=html=>{
    const $=load(html);
    const wrap=s=>({find:q=>wrap(s.find(q)),first:()=>wrap(s.first()),eq:i=>wrap(s.eq(i)),text:()=>s.text(),attr:k=>s.attr(k),length:()=>s.length,each:fn=>s.each((i,e)=>fn(i,wrap($(e))))});
    return q=>wrap($(q));
};
const context=vm.createContext({LoadDoc,fetch,$getUserPreference:key=>({browserMode:'cloak',helperToken:settings.token}[key])});
const provider=vm.runInContext(source+';new Provider()',context);
const results=await provider.search({query:'Death Note'});
console.log(JSON.stringify({count:results.length,first:results[0]}));
if (!results.length) throw new Error('No live EXT results');
const magnet=await provider.getTorrentMagnetLink(results[0]);
const hash=await provider.getTorrentInfoHash(results[0]);
console.log(JSON.stringify({magnetValid:magnet.startsWith('magnet:?'),hash,length:hash.length}));
