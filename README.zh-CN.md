# Electron Benchmarks

[English](README.md) | 简体中文

Electron Benchmarks 帮助开发者衡量 Electron 性能、验证优化效果。测试采用固定场景和标准化流程，减少测量方法不当带来的偏差，统一测量口径。

## 功能特点

- **多种性能指标**：支持启动时间、内存和 CPU 占用测量。
- **版本对比**：支持单版本测试和多版本对比，也支持本地 Electron 构建。
- **统计与复核**：自动预热、多轮测量，汇总 P50/P90，并保存环境信息和逐次样本。
- **Agent 友好**：支持 JSON 配置与结果输出，提供明确的状态、错误和数据完整性信息。

## 结果示例

终端显示进度与简短摘要，同时输出供脚本或 Agent 读取的 JSON 结果。以下为两个版本热启动对比的摘要示意，数值仅用于展示，不代表实际性能：

```text
complete: 40/40 valid formal samples; 0 failed, 0 unexecuted
warm target-1 appReadyMs: P50=120.000 ms
warm target-2 appReadyMs: P50=114.000 ms; delta=-5.00%
Summary: C:\benchmarks\startup-comparison\summary.json
```

`target-1`、`target-2` 对应输入顺序，第一个目标为基准。此例中，第二个目标的启动时间 P50 比基准低 5%。

## 安装

运行环境：

- Windows 10/11 x64。
- Node.js >=22.12。
- 待测 Electron >=22。

```powershell
npm install --global electron-benchmarks@0.1.0
electron-benchmarks --help
```

npm 包包含原生辅助程序与测试场景，使用时无需编译。请在非管理员终端运行，并保持独占、解锁的交互桌面。

## 快速开始

测试一个 Electron 版本的启动时间：

```powershell
electron-benchmarks startup --electron 40.0.0
```

比较两个 Electron 版本的启动时间：

```powershell
electron-benchmarks startup --electron 40.0.0 --electron 41.0.0
```

所需的 Electron 发布版本会自动下载、校验并缓存。测试完成后，终端会显示结果目录中 `summary.json` 的位置。

## 使用说明

### 选择测试项

| 命令 | 测试内容 | 默认预热 / 正式次数（每个目标） |
| --- | --- | --- |
| `startup` 或 `startup:warm` | 热启动时间 | 5 / 20 |
| `memory` | 空闲内存 | 1 / 10 |
| `cpu` | 空闲 CPU | 1 / 10 |

重复 `--electron` 可比较多个目标，第一个目标为基准。`--repeat` 修改每个目标的正式测量次数，不包含预热。例如，对两个版本各测量 3 次空闲内存：

```powershell
electron-benchmarks memory --electron 40.0.0 --electron 41.0.0 --repeat 3
```

版本号须精确，不接受 `latest` 或版本范围。

### 使用本地 Electron

`--electron` 也接受本地可执行文件路径，可用于验证本地构建的优化效果：

```powershell
electron-benchmarks cpu --electron "D:\build\electron.exe" --repeat 3
```

本地可执行文件须位于完整、可运行的 Electron 分发目录中。

### 使用配置文件

将测试配置保存为 `benchmark.json`：

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

JSON 中的相对路径以配置文件目录为基准，CLI 中的相对路径以当前工作目录为基准。`--config` 单独使用，不与测试 CLI 参数混用。完整字段见[配置参考](docs/config.schema.json)。

### 读取结果

默认结果保存在 `%LOCALAPPDATA%\ElectronBenchmarks\runs\` 下，目录按本机时间和测试项命名，如 `20261031-1530-startup`。也可通过 `--out` 指定一个尚不存在的结果目录：

```powershell
electron-benchmarks startup --electron 40.0.0 --out .\results\startup-check
```

先读取 `summary.json` 中的状态、统计指标和版本差值；需要复核时，再查看 `detail/` 中的环境信息、测试安排、样本和日志。任务完成后，可以整体迁移结果目录。

对 AI Agent 和脚本，stdout 输出一个 JSON 结果或错误对象，stderr 输出进度与简短摘要；`--help` 输出纯文本。使用指标前应检查执行状态、数据完整性、错误、样本量和警告。详细字段与退出码见[用户指南](docs/USER-GUIDE.zh-CN.md#3-详细输出与数据消费)。

运行中按 `Ctrl+C`，或创建结果目录下的 `detail/STOP` 文件，可停止当前测试。

## 测量说明

### 指标含义

| 测试 | 主要指标 | 含义 |
| --- | --- | --- |
| 启动 | `appReadyMs`、`videoCallbackMs`，ms | 从父进程发起启动前的计时点，到 Electron 初始化就绪、首次可见视频回调的耗时 |
| 内存 | `privateBytesSumMiB`，MiB | 被测进程组的私有提交量之和；另提供工作集与观察期采样峰值 |
| CPU | `cpuPercentMachine`，%；`cpuTimeSeconds`，s | 按整机逻辑核容量归一化的平均占用，以及观察期累计 CPU 时间 |

汇总提供 P50（中位数）和 P90，版本差值按 P50 计算。预热与失败样本不参与统计，缺失值不补零；基准为零时变化百分比为 `null`。

### 测量条件与结果解读

- 比较结果时，应保持硬件、系统、供电状态和后台负载等条件一致，并核对记录的环境与测量条件。
- 空闲内存和 CPU 测试在静态窗口启动后等待 10 秒，再观察 20 秒，每秒采样一次。
- 启动指标分别反映初始化就绪和视频回调，不代表页面可交互或物理屏幕输出。
- 私有提交量不等于驻留物理内存；工作集求和可能重复计算共享页。CPU 占用的 100% 表示整机逻辑核满载。
- 单样本只用于验证流程。版本差异需要结合样本量与波动判断，不能仅凭一次测量或一个百分比确认性能回归。

### 当前支持范围

0.1.0 支持 Windows 上的热启动、空闲内存和空闲 CPU 测量。冷启动、其他平台、诊断采集和任务管理留待后续。

## 文档

- [用户指南](docs/USER-GUIDE.zh-CN.md)：参数边界、停止测试、结果读取与退出码。
- [配置参考](docs/config.schema.json)：JSON 配置字段与约束。
- [输出格式](docs/output.schema.json)与[样本格式](docs/sample.schema.json)：结构化结果定义。
- [技术方案](docs/TECHNICAL-DESIGN.zh-CN.md)：测试场景、计时与采集方法。
- [启动测量注意事项](docs/electron-startup-measurement-pitfalls.zh-CN.md)：启动指标与测量边界。
- [验证记录](docs/IMPLEMENTATION.zh-CN.md)：已完成的验证及其边界。
- [后续计划](Todo.md)：待办与后续能力。

## 许可证与声明

本项目为独立社区项目，与 Electron 官方无隶属关系，也未经官方背书。

本项目采用 [MIT 许可证](LICENSE)。复用代码与素材的来源及许可情况见[第三方声明](THIRD_PARTY_NOTICES.md)，测试视频保留其 [Chromium 许可证](harness/CHROMIUM-LICENSE)。命令和配置形式参考 Chromium Crossbench。
