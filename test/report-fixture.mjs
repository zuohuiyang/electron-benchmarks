// Synthetic records for output-contract tests only; never used as benchmark results.
import fs from 'node:fs';
import path from 'node:path';
import { plan } from '../dist/config.js';
import { PRESET } from '../dist/model.js';
import { runTime, detailPath } from '../dist/layout.js';
export function reportFixture(test = 'startup', targetCount = 1, repeat = 3) {
  fs.mkdirSync('.test-output', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.test-output/report-test-'));
  fs.mkdirSync(detailPath(root)); fs.mkdirSync(detailPath(root,'samples')); fs.mkdirSync(detailPath(root,'logs'));
  const workRoot = path.resolve('.test-output/fixture-runtime',path.basename(root));
  const inputs = ['40.0.0','41.0.0','C:/fixture/local/electron.exe'];
  const config = { test, electrons: inputs.slice(0,targetCount), repeat, out: root };
  const targets = config.electrons.map((input,index)=>({id:`target-${index+1}`,input,executable:input.endsWith('.exe')?input:`C:/fixture/${input}/electron.exe`,version:input.endsWith('.exe')?'43.0.0-nightly.20260502':input,identity:`test-only-build-${index}`,manifest:[],profileTemplate:path.join(workRoot,'profiles',`template-${index}`)}));
  const steps=plan(config);
  const run={schemaVersion:2,toolVersion:'0.1.0-test-fixture',root,workRoot,time:runTime(new Date(2026,9,31,15,30,12,123)),presets:PRESET,config,targets,steps,next:steps.length,status:'complete',lastBoot:'test-only',userSid:'test-only',nodePath:'C:/fixture/node.exe',nodeSha256:'test-only',toolRoot:'C:/fixture/tool',toolManifest:[],restartCount:0,
    environment:{os:'自动化测试夹具（非实测）',build:'test',architecture:'x64',node:process.version,cpus:[{model:'Fixture CPU'},{model:'Fixture CPU'}],memoryBytes:8*1024**3,controller:{virtualized:false,cpuPriority:32,ioPriority:2,memoryPriority:5}}};
  const samples=steps.map((step,index)=>{
    const n=step.warmup?999:10+step.round*10+step.target;
    const metrics=step.phase==='warm'?{appReadyMs:n,videoCallbackMs:n+100,parentToCreationMs:1+step.target/10,spawnCallMs:2}:step.phase==='memory'?{privateBytesSumMiB:n+100,workingSetSumMiB:n+200,observedWorkingSetPeakMiB:n+250}:{cpuPercentMachine:n/100,cpuTimeSeconds:n/1000};
    return{schemaVersion:1,step,targetId:targets[step.target].id,valid:true,metrics,startedAt:new Date(Date.UTC(2026,9,31,1,0,index)).toISOString(),raw:{source:'synthetic test fixture'}};
  });
  function save(){fs.writeFileSync(detailPath(root,'state.json'),JSON.stringify(run));fs.writeFileSync(detailPath(root,'plan.json'),JSON.stringify({config,steps}));for(const file of fs.readdirSync(detailPath(root,'samples')))fs.unlinkSync(detailPath(root,'samples',file));for(const sample of samples)fs.writeFileSync(detailPath(root,'samples',sample.step.id+'.json'),JSON.stringify(sample));}
  save();return{root,run,samples,save};
}
