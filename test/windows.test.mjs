import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { powershell, updateStartupEntry } from '../dist/windows.js';

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
