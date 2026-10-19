import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NativeInfo } from './model.js';
import { PRESET } from './model.js';
export const exec = promisify(execFile);
export const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const helperPath = (root = TOOL_ROOT): string => path.join(root, 'native', 'windows-helper.exe');
export const powershell = (): string => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
export const localRoot = (): string => path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'ElectronBenchmarks');
export function inspect(pid = process.pid, root = TOOL_ROOT): NativeInfo {
  return JSON.parse(execFileSync(helperPath(root), [String(pid)], { encoding: 'utf8', windowsHide: true, timeout: 15_000 }));
}
export function assertPriority(info: NativeInfo): void {
  if (info.cpuPriority !== 32 || info.ioPriority !== 2 || info.memoryPriority !== 5) throw Error(`Unexpected priority for PID ${info.pid}: CPU=${info.cpuPriority}, IO=${info.ioPriority}, memory=${info.memoryPriority}; expected 32/2/5`);
}
export function assertDesktop(info: NativeInfo): void {
  if (info.elevated) throw Error('Run benchmarks from a non-elevated terminal.');
  if (info.desktop !== 'Default' || info.sessionId === 0 || info.interactiveSessions !== 1 || !info.userSid) throw Error('An unlocked, exclusive interactive Windows desktop is required. Sign out other users.');
  assertPriority(info);
}
export function systemCpu(a: NativeInfo, b: NativeInfo): number {
  const total = BigInt(b.kernelTime) - BigInt(a.kernelTime) + BigInt(b.userTime) - BigInt(a.userTime);
  const idle = BigInt(b.idleTime) - BigInt(a.idleTime);
  if (total <= 0n || idle < 0n || idle > total) throw Error('Invalid system CPU counters');
  return Number(total - idle) / Number(total) * 100;
}
export async function sleep(ms: number, check: () => void): Promise<void> {
  const end = Date.now() + ms;
  do { check(); await new Promise(resolve => setTimeout(resolve, Math.min(250, Math.max(0, end - Date.now())))); } while (Date.now() < end);
  check();
}
export async function waitIdle(logFile: string, check: () => void): Promise<NativeInfo> {
  try {
    const { stdout } = await exec(powershell(), ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -OperationTimeoutSec 5 | Select-Object Name,DiskReadBytesPersec,DiskWriteBytesPersec,CurrentDiskQueueLength | ConvertTo-Json -Compress"], { timeout: 15_000, windowsHide: true });
    fs.appendFileSync(logFile, JSON.stringify({ time: new Date().toISOString(), diskActivityBeforeIdle: JSON.parse(stdout || 'null') }) + '\n');
  } catch (error) { fs.appendFileSync(logFile, JSON.stringify({ diskActivityUnavailable: String(error) }) + '\n'); }
  const started = Date.now(); let previous = inspect(); let stable = 0;
  while (Date.now() - started < PRESET.idleTimeoutMs) {
    await sleep(PRESET.idleIntervalMs, check);
    const current = inspect(); assertDesktop(current);
    const cpu = systemCpu(previous, current); previous = current;
    stable = current.uptimeSeconds >= PRESET.minimumBootSeconds && cpu <= PRESET.cpuLimit ? stable + 1 : 0;
    fs.appendFileSync(logFile, JSON.stringify({ time: new Date().toISOString(), cpuPercentMachine: cpu, uptimeSeconds: current.uptimeSeconds, stable, observerIo: { readBytes: current.readBytes, writeBytes: current.writeBytes } }) + '\n');
    if (stable >= PRESET.idleReadings) return current;
  }
  throw Error('Environment did not become idle within 20 minutes; no sample was taken.');
}
export async function checkAutologon(root = TOOL_ROOT): Promise<Record<string, unknown>> {
  try {
    const { stdout } = await exec(powershell(), ['-NoProfile', '-File', path.join(root, 'tools/windows/autologon.ps1'), 'status', '-Json'], { windowsHide: true, timeout: 15_000 });
    return JSON.parse(stdout.replace(/^\uFEFF/, ''));
  } catch (error) { return { state: 'unknown', message: String(error) }; }
}
export async function environment(): Promise<Record<string, unknown>> {
  const info = inspect(); assertDesktop(info);
  const script = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $os=Get-CimInstance Win32_OperatingSystem; $sys=Get-CimInstance Win32_ComputerSystem; $disks=Get-CimInstance Win32_DiskDrive; $power=powercfg /getactivescheme; [ordered]@{os=$os.Caption;build=$os.BuildNumber;manufacturer=$sys.Manufacturer;model=$sys.Model;disks=@($disks|Select-Object Model,MediaType,Size,Index);power=@($power)}|ConvertTo-Json -Depth 4 -Compress";
  const { stdout } = await exec(powershell(), ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 30_000 });
  return { ...JSON.parse(stdout.replace(/^\uFEFF/, '')), platform: process.platform, architecture: process.arch, node: process.version, cpus: os.cpus(), memoryBytes: os.totalmem(), controller: info, autologon: await checkAutologon() };
}
// Constant script + environment variables avoid injecting CLI paths into PowerShell code.
export async function startup(action: 'install' | 'remove', command: string): Promise<void> {
  const script = `$ErrorActionPreference='Stop'; $key='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; $name='ElectronBenchmarks'; $old=Get-ItemPropertyValue -LiteralPath $key -Name $name -ErrorAction SilentlyContinue; if($env:BENCH_STARTUP_ACTION -eq 'install'){if($old -and $old -ne $env:BENCH_STARTUP_COMMAND){throw 'Another cold benchmark startup is registered'}; if(!(Test-Path -LiteralPath $key)){New-Item -Path $key|Out-Null}; New-ItemProperty -LiteralPath $key -Name $name -Value $env:BENCH_STARTUP_COMMAND -PropertyType String -Force|Out-Null}else{if($old -eq $env:BENCH_STARTUP_COMMAND){Remove-ItemProperty -LiteralPath $key -Name $name}else{if($old){throw 'Startup entry changed; leaving it untouched'}}}`;
  if (action === 'install' && command.length > 260) throw Error('Persistent run path is too long for the Windows Run entry (260 characters).');
  await exec(powershell(), ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, BENCH_STARTUP_ACTION: action, BENCH_STARTUP_COMMAND: command }, windowsHide: true, timeout: 15_000 });
}
export function startupCommand(node: string, cli: string, root: string): string {
  for (const value of [node, cli, root]) if (/["\r\n\0%]/.test(value)) throw Error('Cold-run paths cannot contain quotes, newlines or percent signs.');
  return `"${node}" "${cli}" --continue-cold "${root}"`;
}
export async function reboot(): Promise<void> {
  await exec(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'shutdown.exe'), ['/r', '/t', '0'], { windowsHide: true, timeout: 10_000 });
}
