# electron-benchmarks

English | [简体中文](README.zh-CN.md)

An unofficial Electron benchmark CLI for AI agents. Measure warm startup, idle memory, and idle CPU against exact Electron releases or local distributions. Compare multiple targets using the first as baseline.

## Install

Windows 10/11 x64, Node.js >=22.12, and Electron >=22 are supported. The npm package includes the native helper and workloads; no compiler is needed to use it.

```powershell
npm install --global electron-benchmarks@0.1.0
electron-benchmarks --help
electron-benchmarks startup --electron 40.0.0
electron-benchmarks memory --electron 40.0.0 --electron 41.0.0 --repeat 3
electron-benchmarks cpu --electron "D:\build\electron.exe" --repeat 3
```

Run from a non-elevated terminal on an unlocked, exclusive interactive desktop. Releases are downloaded and verified before measurement, then cached. A local executable must be part of a complete runnable distribution. Startup defaults to 5 warmups and 20 formal samples; memory/CPU default to 1 warmup and 10 formal samples. `--repeat` changes formal samples per target.

## Input and scope

`startup` and `startup:warm` select warm startup. `memory` and `cpu` select idle resource measurements. CLI and JSON use the same test string:

```json
{"test":"startup:warm","electrons":["40.0.0","41.0.0"],"repeat":10}
```

```powershell
electron-benchmarks --config benchmark.json
```

Paths in JSON are relative to the configuration file; CLI paths are relative to the working directory. Use exact versions, not `latest` or ranges. Repeat `--electron` to compare targets; first target is baseline. `--scenario` and a separate JSON `scenario` field are not supported.

**0.1.0 does not provide cold startup.** `startup:cold`, `startup:all`, `all`, and internal cold continuation are rejected before preparation. This release does not reboot Windows or configure startup entries. Other platforms, diagnostics and task management are deferred.

## Results for agents

stdout contains one JSON result or error; progress and a short human summary go to stderr. Read `status`, `dataComplete`, `error`, `cleanupError`, sample counts, and warnings before interpreting metrics. `--help` is plain text.

Default names use local time: `YYYYMMDD-HHmm-startup`, `...-memory`, or `...-cpu`. Automatic collisions get `-2`, `-3`; an explicit `--out` must be new. Each archive contains only:

```text
20261031-1530-startup/
  summary.json
  detail/
    environment.json
    plan.json
    state.json
    samples/000000.json
    logs/
```

Summary protocol v3 includes local/UTC timestamps and time zone, compact environment, effective measurement conditions, target identities, units, P50/P90, P50 baseline differences, and data quality. The stdout `outputDirectory` locates the original result directory. After copying an archive, use its actual location. Artifact paths are relative to the directory containing `summary.json`, so completed archives can be copied together. Runtime profiles are kept separately and cleaned when the task ends. No HTML is generated.

Quantiles use linear interpolation and exclude warmups and failures. Missing values are not zero; baseline zero yields a null percentage. Single samples only validate workflow. Startup endpoints are Electron initialization and the first visible video callback, not page interactivity or physical screen presentation. Private memory is committed memory; summed working sets may double-count shared pages. CPU is normalized over the machine's logical processors.

```powershell
node "$(npm root --global)\electron-benchmarks\examples\read-results.mjs" "<result-directory>\summary.json"
```

Ctrl+C or a `detail/STOP` file stops the current task. Exit codes: 0 complete/full data/cleaned, 1 execution or output failure, 2 invalid input or unsupported test, 130 interrupted. stderr alone does not indicate failure. See [configuration](docs/config.schema.json), [output v3](docs/output.schema.json), [samples v1](docs/sample.schema.json), [user guide](docs/USER-GUIDE.zh-CN.md), and [technical design](docs/TECHNICAL-DESIGN.zh-CN.md).

## Develop

```powershell
npm ci
npm run build
node ./bin/electron-benchmarks.js --help
npm test
npm pack
```

Source builds require Visual Studio C++ x64 build tools. Tests do not run benchmarks or change system settings. See [validation](docs/IMPLEMENTATION.zh-CN.md), [PRD](docs/PRD.zh-CN.md), [TODO](Todo.md), and [code/media notices](THIRD_PARTY_NOTICES.md). CLI/configuration design draws on Chromium Crossbench. This community project is not affiliated with or endorsed by Electron.
