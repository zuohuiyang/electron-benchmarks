# Electron Benchmarks

English | [简体中文](README.zh-CN.md)

Electron Benchmarks helps developers assess Electron performance and validate optimizations. Tests use fixed scenarios and standardized procedures to reduce bias from improper measurement methods and maintain consistent measurement criteria.

## Features

- **Performance metrics**: Measure startup time, memory, and CPU usage.
- **Version comparisons**: Test a single version or compare multiple versions, including local Electron builds.
- **Statistics and review**: Run warmups and repeated measurements, report P50/P90, and retain environment information and individual samples.
- **Agent-friendly interface**: Use JSON configuration and results with explicit status, errors, and data completeness information.

## Installation

Requirements:

- Windows 10/11 x64.
- Node.js >=22.12.
- Electron >=22 for the versions being tested.

```powershell
npm install --global electron-benchmarks
electron-benchmarks --help
```

The npm package includes the native helper and workloads; no compiler is needed to use it. Run from a non-elevated terminal on an unlocked, exclusive interactive desktop.

## Quick start

Measure startup time for one Electron version:

```powershell
electron-benchmarks startup --electron 40.0.0
```

Compare startup time between two Electron versions:

```powershell
electron-benchmarks startup --electron 40.0.0 --electron 41.0.0
```

Electron releases are automatically downloaded, verified, and cached. When the test finishes, the terminal shows the location of `summary.json` in the result directory.

## Usage

### Choose a test

| Command | Measurement | Default warmups / formal runs per target |
| --- | --- | --- |
| `startup` or `startup:warm` | Warm startup time | 5 / 20 |

| `startup:cold` | First launch after Windows restarts | 0 / 20 |
| `startup:all` | Cold startup followed by warm startup | Per-phase defaults |
| `all` | Cold startup, warm startup, idle memory, idle CPU | Per-phase defaults |
| `memory` / `memory:idle` | Idle memory | 1 / 10 |
| `cpu` / `cpu:idle` | Idle CPU | 1 / 10 |

Repeat `--electron` to compare targets; the first is the baseline. `--repeat` changes the number of formal runs per target, excluding warmups. For example, measure idle memory three times for each of two versions:

```powershell
electron-benchmarks memory:idle --electron 40.0.0 --electron 41.0.0 --repeat 3
```

Use exact version numbers. `latest` and version ranges are not accepted.

### Cold startup

```powershell
electron-benchmarks startup:cold --electron 41.0.0 --repeat 1
```

Each cold sample requires a Windows restart. Confirm the total in an interactive terminal before the first restart. Two targets at the default count require 40 restarts. Sign in to the same account after each restart to continue automatically. Follow `summary.json` for progress and the final result. Press Ctrl+C during execution or create `detail/STOP` to cancel.

### Use a local Electron build

`--electron` also accepts a local executable path, which can be used to validate optimizations in a local build:

```powershell
electron-benchmarks cpu:idle --electron "D:\build\electron.exe" --repeat 3
```

The executable must be part of a complete, runnable Electron distribution. Every run copies each target’s runtime files once and uses that copy for preflight, warmups, and formal measurements.

### Use a configuration file

The static-window idle scenario is available as `memory:idle` and `cpu:idle`.

Save the test configuration as `benchmark.json`:

```json
{
  "test": "startup:warm",
  "electrons": ["40.0.0", "41.0.0"],
  "repeat": 10
}
```

```powershell
electron-benchmarks --config benchmark.json
```

Paths in JSON are relative to the configuration file; CLI paths are relative to the working directory. Use `--config` on its own, without test CLI arguments. See the [configuration reference](docs/config.schema.json) for all fields.

Use `--deploy-to <directory>` (JSON: `deployTo`) to run each Electron target from a separate copy on the chosen drive. The copies keep the same paths across restarts. If omitted, the copies use the test account’s local workspace. The harness and profiles keep their usual location, and `--out` controls where reports and logs go. For SSD/HDD comparisons, run one batch per drive with a separate output directory.

For unattended sequential jobs, use a JSON object with a top-level `jobs` array. Each item is a complete configuration with its own `deployTo` and `out` as needed. Start with `--config` and confirm the entire restart sequence once. A failed or interrupted job stops the queue. After execution, Notepad opens `summary.json`. A multi-job summary is stored under `%LOCALAPPDATA%\ElectronBenchmarks\queues\runs` and links to each job report. The CLI prints the full summary path at startup for multi-job runs.

The console shows the current job, deployment directory, and sample number for each target. After a cold restart and login, Windows opens a new Electron Benchmarks console and resumes the run.

### Read results

Results are saved under `%LOCALAPPDATA%\ElectronBenchmarks\runs\` by default. Directories are named using local time and the test name, such as `20261031-1530-startup`. Use `--out` to specify a result directory that does not yet exist:

```powershell
electron-benchmarks startup --electron 40.0.0 --out .\results\startup-check
```

Read `summary.json` first for status, statistics, and version differences. For further review, use the environment information, test plan, samples, and logs in `detail/`. The entire result directory can be moved after the test finishes.

For AI agents and scripts, stdout contains one JSON result or error object; progress and a short summary go to stderr. `--help` is plain text. Check execution status, data completeness, errors, sample counts, and warnings before using metrics. See the [user guide (Chinese)](docs/USER-GUIDE.zh-CN.md#3-详细输出与数据消费) for detailed fields and exit codes.

Press `Ctrl+C` or create a `detail/STOP` file in the result directory to stop the current test.

### Example results

The terminal shows progress and a short summary, alongside JSON results for scripts and agents. The following illustrates a warm-startup comparison between two versions. The numbers are examples, not actual measurements:

```text
complete: 40/40 valid formal samples; 0 failed, 0 unexecuted
warm target-1 appReadyMs: P50=120.000 ms
warm target-2 appReadyMs: P50=114.000 ms; delta=-5.00%
Summary: C:\benchmarks\startup-comparison\summary.json
```

`target-1` and `target-2` follow the input order; the first target is the baseline. In this example, the second target's P50 startup time is 5% lower than the baseline.

## Measurement notes

### Metrics

| Test | Key metrics | Meaning |
| --- | --- | --- |
| Startup | `appReadyMs`, `videoCallbackMs`, ms | Time from the parent process's timing point just before launch to Electron initialization and the first visible video callback |
| Memory | `privateBytesSumMiB`, MiB | Summed private committed memory of the measured process group; working sets and their sampled peak during observation are also reported |
| CPU | `cpuPercentMachine`, %; `cpuTimeSeconds`, s | Average CPU usage normalized over all logical processors, and cumulative CPU time during observation |

Summaries report P50 (median) and P90. Version differences use P50. Warmups and failed samples are excluded; missing values are not replaced with zero. A zero baseline yields a `null` percentage change.

### Conditions and interpretation

- Keep hardware, system, power state, and background load consistent when comparing results, and check the recorded environment and measurement conditions.
- Idle memory and CPU tests wait 10 seconds after the static window starts, then observe for 20 seconds with one sample per second.
- Startup metrics describe initialization and a video callback, not page interactivity or physical screen presentation.
- Private committed memory is not resident physical memory. Summed working sets may count shared pages more than once. CPU usage of 100% means all logical processors are fully occupied.
- A single sample only validates the workflow. Assess version differences alongside sample counts and variability; one measurement or percentage alone does not establish a regression.

### Current scope

Version 0.2.1 supports cold startup, warm startup, idle memory, and idle CPU on Windows.

## Documentation

- [Changelog](CHANGELOG.md)
The prose guides below are currently in Chinese.

- [User guide](docs/USER-GUIDE.zh-CN.md): Parameter constraints, stopping tests, reading results, and exit codes.
- [Configuration reference](docs/config.schema.json): JSON configuration fields and constraints.
- [Output format](docs/output.schema.json) and [sample format](docs/sample.schema.json): Structured result definitions.
- [Technical design](docs/TECHNICAL-DESIGN.zh-CN.md): Test scenarios, timing, and collection methods.
- [Startup measurement notes](docs/electron-startup-measurement-pitfalls.zh-CN.md): Startup metrics and measurement boundaries.
- [Validation records](docs/IMPLEMENTATION.zh-CN.md): Completed checks and their limitations.
- [Roadmap](Todo.md): Planned work and future capabilities.

## License and disclaimer

This is an independent community project, not affiliated with or endorsed by Electron.

This project is licensed under the [MIT License](LICENSE). See the [third-party notices](THIRD_PARTY_NOTICES.md) for the origins and licensing status of reused code and media. The test video retains its [Chromium license](harness/CHROMIUM-LICENSE). The command and configuration design draws on Chromium Crossbench.
