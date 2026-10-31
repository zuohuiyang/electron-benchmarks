import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadRelease} from '../dist/targets.js';
test('artifact preparation retries a transient failure once and still requires verified success',async()=>{
 let calls=0;
 const result=await downloadRelease('40.0.0',async input=>{assert.equal(input.version,'40.0.0');if(++calls===1)throw Error('fetch failed');return 'verified.zip';});
 assert.equal(result,'verified.zip');assert.equal(calls,2);
});
test('download failure is bounded and has an actionable structured cause',async()=>{
 let calls=0;
 await assert.rejects(()=>downloadRelease('40.0.0',async()=>{calls++;throw Object.assign(Error('fetch failed'),{cause:{code:'ECONNRESET'}});}),e=>e.code==='DOWNLOAD_FAILED'&&e.stage==='prepare'&&/2 attempts.*ECONNRESET.*network/.test(e.message));
 assert.equal(calls,2);
});
