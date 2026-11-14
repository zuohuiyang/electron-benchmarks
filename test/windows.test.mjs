import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { powershell, updateStartupEntry, waitForIdleReadings } from '../dist/windows.js';

test('idle progress follows boot time, recent CPU readings and consecutive qualifying readings', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-idle-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'idle.ndjson');
  const progress = [];
  const cpu = [0, 4, 5, 15, 6, 7, 8];
  let reading = 0, idle = 0;
  const result = await waitForIdleReadings(log, () => {}, message => progress.push(message), {
    inspect() {
      const index = reading++;
      idle += 100 - cpu[index];
      return {
        uptimeSeconds: 116 + index * 2, kernelTime: String(index * 100), userTime: '0', idleTime: String(idle),
        cpuPriority: 32, ioPriority: 2, memoryPriority: 5, desktop: 'Default', sessionId: 1, interactiveSessions: 1, userSid: 'fixture'
      };
    },
    async sleep(ms, check) { assert.equal(ms, 2000); check(); }
  });
  assert.match(progress[0], /116\/120 s elapsed, 4 s remaining/);
  assert.match(progress[1], /4\.0%.*3 more consecutive/);
  assert.match(progress[2], /120\/120 s elapsed, 0 s remaining.*4\.0%, 5\.0%.*limit ≤ 10%.*2 more consecutive/);
  assert.match(progress[3], /4\.0%, 5\.0%, 15\.0%.*3 more consecutive/);
  assert.match(progress.at(-1), /6\.0%, 7\.0%, 8\.0%.*0 more consecutive/);
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line).stable), [0, 1, 0, 1, 2, 3]);
  assert.equal(result.uptimeSeconds, 128);
});

test('startup entry handles missing registry keys and values without replacing conflicts', { skip: process.platform !== 'win32' }, async () => {
  const subkey = `Software\\ElectronBenchmarksTest-${randomUUID()}`;
  const command = '"C:\\test\\node.exe" "C:\\test\\cli.js" --continue-cold';
  const run = script => execFileSync(powershell(), [
    '-NoProfile', '-NonInteractive', '-Command',
    `$ErrorActionPreference = 'Stop'; $key = 'HKCU:\\${subkey}'; ${script}`,
  ], { encoding: 'utf8', timeout: 15_000 }).trim();
  const conflictingCommand = /Another command occupies HKCU Run\/ElectronBenchmarks/;

  try {
    await updateStartupEntry('check', command, subkey);
    await updateStartupEntry('remove', command, subkey);
    assert.equal(run('Test-Path -LiteralPath $key'), 'False');

    run('New-Item -Path $key | Out-Null');
    await updateStartupEntry('check', command, subkey);
    await updateStartupEntry('remove', command, subkey);
    await updateStartupEntry('install', command, subkey);
    assert.equal(run('Get-ItemPropertyValue -LiteralPath $key -Name ElectronBenchmarks'), command);
    await updateStartupEntry('check', command, subkey);

    const otherCommand = command.toUpperCase();
    for (const action of ['check', 'install', 'remove']) {
      await assert.rejects(updateStartupEntry(action, otherCommand, subkey), conflictingCommand);
    }
    assert.equal(run('Get-ItemPropertyValue -LiteralPath $key -Name ElectronBenchmarks'), command);

    await updateStartupEntry('remove', command, subkey);
    await updateStartupEntry('check', command, subkey);
    assert.equal(run('(Get-Item -LiteralPath $key).GetValueNames().Length'), '0');
    run("New-ItemProperty -LiteralPath $key -Name ElectronBenchmarks -Value '%SystemRoot%\\test.exe' -PropertyType ExpandString | Out-Null");
    await assert.rejects(updateStartupEntry('install', `${process.env.SystemRoot}\\test.exe`, subkey), conflictingCommand);
    await updateStartupEntry('remove', '%SystemRoot%\\test.exe', subkey);
  } finally {
    run('if (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key }');
  }
});
