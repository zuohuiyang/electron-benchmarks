# Electron Benchmarks

English | [简体中文](README.zh-CN.md)

An unofficial Electron benchmark CLI for AI agents: reproducible startup, memory, and CPU measurements with structured results across versions.

This is an independent community project and is not affiliated with or endorsed by the Electron project.

## Purpose

Electron Benchmarks aims to measure Electron's own performance through standardized scenarios. It helps developers compare versions, detect performance regressions, and validate optimizations.

The initial Windows CLI is implemented. Full reboot-based cold-run validation on a dedicated physical machine is still pending; local workflow checks are not published performance claims.

## Build and run

Windows 10/11 x64, Node.js >=22.12, and Electron >=22 are supported. Building from source requires Visual Studio C++ x64 build tools. A packaged npm artifact includes the native helper; this project has not yet been published to npm.

```powershell
npm ci
npm run build
node ./bin/electron-bench.js --help

# Warm startup: 5 warmups, then 20 formal runs by default
node ./bin/electron-bench.js startup --electron "D:\build\electron.exe"

# Exact published releases are downloaded and cached; first target is baseline
node ./bin/electron-bench.js startup --electron 40.0.0 --electron 41.0.0 --repeat 10

node ./bin/electron-bench.js memory --electron "D:\build\electron.exe" --repeat 3
node ./bin/electron-bench.js cpu --electron "D:\build\electron.exe" --repeat 3
```

Run from a non-elevated terminal on an unlocked, exclusive interactive desktop. Published versions require network access during preparation only. Local input paths must point to a complete runnable distribution or a GN build output containing its runtime assets. The CLI fingerprints runtime assets, excluding compiler intermediates and symbols.

## Cold startup and all tests

```powershell
node ./bin/electron-bench.js startup --electron "D:\build\electron.exe" --scenario cold --repeat 10
node ./bin/electron-bench.js all --electron "D:\build\electron.exe" --repeat 3
```

**These commands can reboot Windows after explicit interactive confirmation.** `all` runs cold, warm, memory, then CPU. Each cold sample requires a separate reboot and sign-in. Files are prepared first; startup uses an HKCU Run entry, never Task Scheduler. A missing automatic-login configuration is advisory: sign in manually after each reboot, or use the separate [Windows helper](tools/windows/README.md). The main CLI never enables or disables automatic login.

Use a persistent output directory outside the tool installation, or accept the default under `%LOCALAPPDATA%/ElectronBenchmarks/runs/`. Cold runs freeze the tool, dependencies and Node executable into `tool/` there. Do not move or edit the run, tool snapshot, target distribution or original tool installation until the test completes. A new process's controller and main Electron CPU/IO/memory priorities must be Normal/2/5.

Cold runs wait at least 120 seconds after boot, then require 3 system CPU readings <=10%, 2 seconds apart, with a 20-minute timeout. Every reboot has a 15-second cancellable countdown; no forced shutdown is requested. Ctrl+C or an empty `STOP` file in the output directory ends the run and cleans its temporary startup entry. If the process was forcibly killed, a later launch cleans stale state; a waiting-reboot task can be stopped by creating `STOP` and invoking the CLI again. Cleanup failures identify the exact remaining registry entry. Interrupted runs do not resume automatically, except normal planned reboot continuation.

## Configuration and output

```powershell
node ./bin/electron-bench.js --config ./examples/benchmark.json
```

Config fields are `test`, `electrons`, optional `scenario`, `repeat`, and `out`; relative paths are relative to the config file. Config files cannot be mixed with test arguments. See the [schema](docs/config.schema.json) and [example](examples/benchmark.json).

Each normal test invocation emits one JSON object on stdout. Progress, prompts, and a short human summary go to stderr. Results include `summary.json`, `environment.json`, the frozen `plan.json`, task state in `run.json`, per-run JSON samples and environment logs. No HTML is generated. Failed and warmup samples are retained and excluded from formal quantiles. P50/P90 use linear interpolation. Do not compare different timing origins, scenario versions or hardware as equivalent experiments.

Agents should read the compact summary first, then follow `artifacts` paths for environment and raw data as needed. The summary declares the baseline, metric units and definitions, P50/P90, P50 differences, sample counts, missing metrics, and warnings. Check `status`, `dataComplete`, `error`, `cleanupError`, and sample counts before interpreting values. A single sample is flagged and cannot establish a performance regression. Failed, unmeasured, and missing metrics remain distinct from measured zero.

Output protocol v2 is defined in [output.schema.json](docs/output.schema.json); samples retain [schema v1](docs/sample.schema.json). See the [consumer example](examples/read-results.mjs):

```powershell
node ./examples/read-results.mjs ./results/startup-comparison/summary.json
```

Exit codes: `0` complete with full data and successful cleanup, `1` execution/output failure or incomplete data, `2` invalid input, `130` interrupted or reboot consent declined (cleanup failure takes precedence as `1`). Errors expose `code`, `stage`, and `message`; stderr text is not an error signal. `--help` remains plain text. Noninteractive cold/all calls return `REBOOT_CONSENT_REQUIRED` before preparation. During authorized reboots, process termination is not task completion: inspect persistent `run.json` and `summary.json` until the task reaches a terminal state. Artifact paths are absolute on the measurement host; relocate them when copying a run.

Startup measures parent-before-spawn to APP READY and the first observed visible video callback, using the [reused QPC/FILETIME clock bridge](THIRD_PARTY_NOTICES.md). The latter is not physical screen presentation. Resource tests use a static page, wait 10 seconds, then observe for 20 seconds at 1-second intervals. Private bytes measure private committed memory; working-set sums may double-count shared pages. CPU uses Windows cumulative process-time deltas, normalized over all logical processors; Electron's raw percentage counters are retained but are not the formal CPU metric. Hypervisor presence is reported and does not establish physical-machine cold performance.

## Development

```powershell
npm test
powershell.exe -NoProfile -File ./tools/windows/tests/autologon.Tests.ps1
npm pack
```

Unit tests do not reboot, register startup entries or alter automatic login. See [implementation and validation](docs/IMPLEMENTATION.zh-CN.md), [PRD](docs/PRD.zh-CN.md), [TODO](Todo.md), and [reused code/media notices](THIRD_PARTY_NOTICES.md).

## Test modes

- **Single-version testing**: Run standardized scenarios against one Electron version and report metrics, raw samples, and environment details.
- **Multi-version comparison**: Run the same standardized scenarios against multiple Electron versions in the same environment. Choose a baseline version and report each version's metrics, absolute differences, and percentage changes relative to that baseline.

## Structure

Standardized scenarios define the workloads. A shared Runner executes scenarios and collects data. A summarizer produces structured measurements and baseline comparisons. Callers create any tables, charts, or HTML they need.

Configuration, repeated runs, and reporting design draw on Chromium Crossbench.

## Initial scope

The first phase focuses on standardized performance testing of Electron itself on Windows. Testing arbitrary user applications is outside the initial scope.
