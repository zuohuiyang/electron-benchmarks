import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {outputRoot,createOutputRoot,createWorkRoot,cleanupWorkRoot,runTime} from '../dist/layout.js';
import {report} from '../dist/report.js';
import {reportFixture} from './report-fixture.mjs';
const fresh=prefix=>{fs.mkdirSync('.test-output',{recursive:true});return fs.mkdtempSync(path.resolve('.test-output/'+prefix));};

test('automatic names use local minute and canonical test, collision suffixes never overwrite',()=>{
 const base=fresh('names-'),now=new Date(2026,9,31,15,30,59,123),config={test:'startup',electrons:['40.0.0']};
 const first=createOutputRoot(config,base,now);
 assert.equal(path.basename(first),'20261031-1530-startup');fs.writeFileSync(path.join(first,'keep'),'original');
 assert.equal(path.basename(createOutputRoot({...config,test:'startup:warm'},base,now)),'20261031-1530-startup-2');
 assert.equal(path.basename(createOutputRoot(config,base,now)),'20261031-1530-startup-3');
 assert.equal(fs.readFileSync(path.join(first,'keep'),'utf8'),'original');
 for(const name of ['memory','cpu'])assert.equal(path.basename(outputRoot({...config,test:name},base,now)),`20261031-1530-${name}`);
});

test('explicit output conflicts are rejected without replacing data',()=>{
 const base=fresh('out-'),out=path.join(base,'chosen');fs.mkdirSync(out);fs.writeFileSync(path.join(out,'keep'),'original');
 assert.throws(()=>createOutputRoot({test:'startup',electrons:['40.0.0'],out},base),e=>e.code==='OUTPUT_EXISTS');
 assert.equal(fs.readFileSync(path.join(out,'keep'),'utf8'),'original');
 assert.equal(fs.existsSync(out+'-2'),false);
});

test('workspaces are separate and cleanup refuses a parent or unrelated path',()=>{
 const base=fresh('workspace-'),workRoot=createWorkRoot(base);
 assert.match(path.basename(workRoot),/^[0-9a-f]{8}$/);assert.equal(path.dirname(workRoot),path.join(base,'w'));
 const unrelated=path.join(base,'keep');fs.mkdirSync(unrelated);
 for(const invalid of [base,path.join(base,'w'),unrelated])assert.throws(()=>cleanupWorkRoot({workRoot:invalid},base),/Refusing/);
 cleanupWorkRoot({workRoot},base);assert.equal(fs.existsSync(workRoot),false);assert(fs.existsSync(unrelated));
});

test('structured timestamps retain milliseconds and explicit local zone/offset',()=>{
 const t=runTime(new Date(2026,9,31,15,30,12,123));
 assert.match(t.localStartedAt,/^2026-10-31T15:30:12\.123[+-]\d{2}:\d{2}$/);
 assert.equal(Date.parse(t.startedAt),Date.parse(t.localStartedAt));assert(t.timeZone);assert(Number.isInteger(t.utcOffsetMinutes));
});

test('summary preserves compact environment and effective conditions for every supported phase',()=>{
 for(const name of ['startup','memory','cpu']){
  const f=reportFixture(name,1,2);f.run.presets={...f.run.presets,observeMs:21000};f.save();const s=report(f.run);
  assert.deepEqual(fs.readdirSync(f.root).sort(),['detail','summary.json']);
  assert.equal(s.environment.cpu.logicalCores,2);assert.deepEqual(s.environment.cpu.models,['Fixture CPU']);
  assert.equal(s.environment.memoryBytes,8*1024**3);assert.equal(s.environment.virtualized,false);
  assert.equal(s.environment.cpus,undefined);assert.equal(s.outputDirectory,f.root);
  assert.equal(s.conditions.formalRunsPerTarget[s.scenarios[0]],2);
  assert.equal(s.conditions.warmupsPerTarget[s.scenarios[0]],name==='startup'?5:1);
  assert.equal(s.conditions.resourceObservation?.observeMs,name==='startup'?undefined:21000);
  assert.equal(s.time.startedAt,f.run.time.startedAt);
 }
});

test('relative artifacts remain usable after moving the whole archive and changing cwd',()=>{
 const f=reportFixture('startup',2,2),s=report(f.run),base=fresh('relocated-'),dest=path.join(base,'archive');
 fs.cpSync(f.root,dest,{recursive:true});
 assert.deepEqual(fs.readFileSync(path.join(dest,'summary.json')),fs.readFileSync(path.join(f.root,'summary.json')));
 const child=spawnSync(process.execPath,[path.resolve('examples/read-results.mjs'),path.join(dest,'summary.json')],{encoding:'utf8',cwd:base});
 assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout);
 assert.equal(result.artifacts.summary,path.join(dest,'summary.json'));
 assert.equal(result.artifacts.environment,path.join(dest,'detail/environment.json'));
 assert.equal(result.rows[0].p50,s.groups[0].metrics.appReadyMs.p50);
 for(const value of Object.values(s.artifacts).filter(Boolean)){assert.equal(path.isAbsolute(value),false);assert(fs.existsSync(path.join(dest,value)));}
});
