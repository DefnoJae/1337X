import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHelper, detailPath, pagePath } from '../helper/server.mjs';

test('helper only accepts EXT anime searches and release detail paths',()=>{
    assert.equal(pagePath('/browse/?q=Death+Note&cat=7&with_adult=0'),true);
    for (const value of ['https://evil.test/','//evil.test/','/browse/?cat=7&with_adult=1','/browse/?cat=7&with_adult=0&url=http://evil.test','/browse/../?cat=7&with_adult=0']) assert.equal(pagePath(value),false);
    assert.equal(detailPath('/death-note-123/'),true);
    for(const value of ['//evil.test-123/','/../secret-123/','https://ext.to/thing-123/','/browse/?q=test']) assert.equal(detailPath(value),false);
});

test('helper authenticates requests, rejects browser origins, and serializes browser work',async()=>{
    let active=0, max=0;
    const server=createHelper({token:'test-token',loadPage:async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10));active--;return '<table></table>';},getMagnet:async()=>{throw new Error('verification required');}});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const port=server.address().port;
    function request(route,token='test-token',extra={}) {
        return new Promise((resolve,reject)=>{
            const req=http.request({host:'127.0.0.1',port,path:route,method:'POST',headers:{Host:'127.0.0.1:18731',Authorization:'Bearer '+token,'Content-Type':'application/json',...extra}},res=>{
                let body='';res.on('data',d=>body+=d);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));
            });req.on('error',reject);req.end(JSON.stringify({path:route==='/magnet'?'/title-123/':'/browse/?q=test&cat=7&with_adult=0'}));
        });
    }
    try {
        assert.equal((await request('/page','wrong')).status,401);
        assert.equal((await request('/page','test-token',{Origin:'https://evil.test'})).status,403);
        assert.equal((await request('/page','test-token',{Host:'evil.test'})).status,403);
        const results=await Promise.all([request('/page'),request('/page')]);
        assert.equal(results.every(r=>r.status===200),true);
        assert.equal(max,1);
        assert.match((await request('/magnet')).body.error,/verification required/);
    } finally { await new Promise(r=>server.close(r)); }
});
