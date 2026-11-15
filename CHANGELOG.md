# Changelog

## [0.2.5](https://github.com/zuohuiyang/electron-benchmarks/releases/tag/v0.2.5) · 2026-11-14

- Preserve raw Electron stderr in every sample for diagnostics. Startup samples use structured startup events and exit status for validation. CPU and memory samples use observed metrics and exit status.
- Show elapsed and remaining boot wait time, recent CPU readings, the number of consecutive readings still needed, and the next benchmark round.

## [0.2.4](https://github.com/zuohuiyang/electron-benchmarks/releases/tag/v0.2.4) · 2026-11-14

- Fix cold-start queue preparation in Windows PowerShell 5.1 when the current user's Windows Run key or ElectronBenchmarks entry is missing. Preserve existing conflicting entries.

## [0.2.3](https://github.com/zuohuiyang/electron-benchmarks/releases/tag/v0.2.3) · 2026-11-14

- Show the current job, deployment directory, and sample number for each target.
- Resume cold-start jobs in a visible Electron Benchmarks console after Windows sign-in.

## [0.2.2](https://github.com/zuohuiyang/electron-benchmarks/releases/tag/v0.2.2) · 2026-11-14

- Add `--deploy-to` and JSON `deployTo` to place isolated Electron copies on a selected drive and reuse their paths across restarts.
- Run sequential, resumable benchmarks from a JSON `jobs` array. Write a queue summary that links to each job's results and open the final `summary.json` in Notepad.

## [0.2.1](https://github.com/zuohuiyang/electron-benchmarks/tree/v0.2.1) · 2026-11-14

- Copy each Electron target's runtime files once per run and use the isolated copy for preflight, warmups, and measured samples.

## [0.2.0](https://github.com/zuohuiyang/electron-benchmarks/releases/tag/v0.2.0) · 2026-11-14

- Add Windows cold-start benchmarks with `startup:cold`. Runs resume after sign-in following each restart.
- Add `startup:all` for cold and warm startup, and `all` to also measure idle memory and CPU.
- Add explicit `memory:idle` and `cpu:idle` selectors. The `memory` and `cpu` aliases remain available.

## [0.1.0](https://github.com/zuohuiyang/electron-benchmarks/releases/tag/v0.1.0) · 2026-11-01

- Publish the first CLI release on npm, with warm startup, idle memory, and idle CPU benchmarks on Windows x64.
- Compare published Electron versions and local builds using CLI arguments or JSON configuration.
- Report P50, P90, and baseline differences in structured JSON, and save individual samples alongside `summary.json`.
