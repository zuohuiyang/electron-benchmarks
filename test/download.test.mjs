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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyTarget, distributionManifest, verifyTarget } from '../dist/targets.js';

test('target preparation copies only runtime assets and pins a verified per-target path', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cold-target-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const original = path.join(root, 'build', 'electron.exe');
  fs.mkdirSync(path.join(root, 'build', 'locales'), { recursive: true });
  fs.writeFileSync(original, 'original binary');
  fs.writeFileSync(path.join(root, 'build', 'locales', 'en-US.pak'), 'locale');
  fs.writeFileSync(path.join(root, 'build', 'electron.pdb'), 'symbols');
  const target = { id: 'target-1', executable: original, manifest: distributionManifest(original) };
  const work = path.join(root, 'work');
  copyTarget(target, work);
  assert.equal(target.executable, path.join(work, 'targets', target.id, 'electron.exe'));
  assert.equal(fs.existsSync(path.join(path.dirname(target.executable), 'electron.pdb')), false);
  fs.writeFileSync(original, 'rebuilt after preparation');
  verifyTarget(target);
  assert.equal(fs.readFileSync(target.executable, 'utf8'), 'original binary');
});
