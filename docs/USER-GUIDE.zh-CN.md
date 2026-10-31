# electron-benchmarks 详细用户说明

更新日期：2026-10-31

首次使用见 [PRD / 简明使用说明](PRD.zh-CN.md)。本文补充参数边界、取消和异常处理、结果字段及退出码。实现原理见[技术方案](TECHNICAL-DESIGN.zh-CN.md)。

本文对应 0.1.0。只提供 `startup` / `startup:warm`、`memory` 和 `cpu`；冷启动及组合入口留待后续，不会执行重启或自启动设置。

## 1. 安装与输入约定

安装验收要求：在干净目录完成 npm 安装后，`electron-benchmarks --help` 可直接运行并正常退出；使用安装后的命令完成一次热启动测试，得到可解析的 JSON 结果。

只接受简明说明中列出的四种测试写法，最多一个冒号。旧的 `--scenario` 参数和 JSON `scenario` 字段不再接受；拼写错误会报错并提示正确写法，未支持的内存或 CPU 场景不会自动替换成其他测试。

版本号必须精确，不接受 `latest` 或版本范围。本地路径须指向完整、可运行的 Electron 构建，不能只复制一个可执行文件；同版本号的不同构建通过目标 ID 和构建身份区分。

`--repeat` 范围为 1–10000，不包含预热。热启动每个目标预热 5 次，内存和 CPU 各预热 1 次。显式次数对每个目标分别生效。

CLI 中的相对路径以当前工作目录为基准，JSON 中的相对路径以配置文件目录为基准。`--config` 不与测试 CLI 参数混用。自动目录重名追加 `-2`、`-3`；显式指定的 `--out` 已存在时报错，不覆盖或自动改名。

## 2. 取消与中断

运行中按 `Ctrl+C`，或在输出目录的 `detail/` 中创建名为 `STOP` 的空文件：

```powershell
New-Item -ItemType File -Path "<结果目录>\detail\STOP"
```

将占位路径替换为实际输出目录。工具在运行时读取停止请求，停止测量并清理运行工作目录，已有数据保留。

异常中断后的断点续测尚未提供。遇到错误先读取结果中的失败原因，处理后用新目录重新发起测试。清理失败时按工具给出的提示处理残留项。

## 3. 详细输出与数据消费

### 3.1 结果在哪里

准备完成后，终端显示本次结果目录；结束时显示 `summary.json` 的位置。默认在启动测试账户的 `%LOCALAPPDATA%\ElectronBenchmarks\runs\` 下，目录名称为 `YYYYMMDD-HHmm-测试名`，时间精确到分钟，使用本机时区：

| 测试 | 目录名称示例 |
| --- | --- |
| `startup`、`startup:warm` | `20261031-1530-startup` |
| `memory` | `20261031-1535-memory` |
| `cpu` | `20261031-1540-cpu` |

启动测试的目录名统一使用 `startup`，具体选择器和执行场景保存在汇总中。同一分钟、同类测试自动生成目录时，发生重名依次追加 `-2`、`-3`，不覆盖历史结果。用户显式指定 `--out` 时按原样使用该路径，目录已存在则报错，不自动改名。完整开始时间、本机时区及相对 UTC 的偏移保存在结构化结果中，不因目录名只精确到分钟而丢失。

结果根目录只包含 `summary.json` 和 `detail/`：

```text
20261031-1530-startup/
  summary.json
  detail/
    environment.json
    plan.json
    state.json
    samples/
      000000.json
      000001.json
    logs/
```

| 输出 | 用途 |
| --- | --- |
| stdout / `summary.json` | 状态、必要环境摘要、实际测量条件、目标与基准、指标、差值、样本数量、完整性、警告和错误；默认先读它 |
| `detail/environment.json` | 完整环境记录，按需复核 |
| `detail/plan.json` | 固定的测试安排与执行顺序 |
| `detail/state.json` | 当前任务状态与进度；原 `run.json` 更名为 `state.json` |
| `detail/samples/` | 逐次正式和预热记录，按固定宽度的执行序号命名，供复核失败与波动 |
| `detail/logs/` | 集中保存日志 |
| stderr | 进度、交互提示和简短人工摘要 |

profile 等运行文件由工具在独立工作目录管理，结束后清理，不混入结果目录。归档不依赖这些运行文件；任务结束后可以整体复制或迁移结果目录，任务进行中不要移动它。工具不生成 HTML。

测试进程正常退出时 stdout 是一个 JSON 对象；有运行结果时与 `summary.json` 一致。准备失败时可能只返回结构化错误，结果文件也可能尚未生成。stderr 有内容不代表失败，不要通过解析日志文案判断任务是否成功。

### 3.2 判断是否可用

AI 或脚本先检查以下字段，再使用指标：

| 字段 | 读取方式 |
| --- | --- |
| `kind` | `result` 为测试结果；`error` 为尚未形成结果的错误 |
| `status` | `complete` 为执行完成；`failed` 和 `interrupted` 表示失败或中断 |
| `dataComplete` | 必须为 `true`，表示正式样本和所需指标齐全 |
| `error`、`cleanupError` | 成功结果两者均为 `null` |
| `valid`、`planned`、`failed`、`unexecuted` | 核对有效、计划、失败、未执行数量，并检查每组样本量 |
| `warnings` | 查看小样本和数据不完整等提示 |
| `environment` | 必要环境摘要：系统版本、架构、CPU 型号与逻辑核数、内存容量、虚拟化等 |
| `conditions` | 本次实际采用的预热次数、正式次数、观察时长、采样间隔等测量条件 |
| `test`、`scenarios`、`time` | 测试选择器、具体场景，以及完整时间和时区 |
| `groups`、`metricDefinitions` | 按目标和场景读取指标，查询单位与含义 |
| `baselineTarget`、`targets` | 确定基准版本及每个目标的构建身份 |
| `outputDirectory` | CLI 本次结果的原始位置；迁移后以实际读取的汇总文件位置为准 |
| `artifacts` | 详细文件相对于本次结果目录的路径；以 `summary.json` 所在目录为基准解析 |

可用安装包附带的示例读取已完成结果，替换为实际汇总路径：

```powershell
node "$(npm root --global)\electron-benchmarks\examples\read-results.mjs" "<结果目录>\summary.json"
```

AI 通常只需读取汇总中的环境摘要与测量条件，需要复核时再按 `artifacts` 读取详细环境和逐次样本。引用均为相对路径，整体迁移目录后仍按新的结果目录解析，无需修改 JSON。

### 3.3 指标与对比怎么读

| 测试 | 主要结果与单位 | 含义 |
| --- | --- | --- |
| 启动 | `appReadyMs`、`videoCallbackMs`，ms | Electron 初始化就绪、首次可见视频回调的耗时；分别不代表页面可交互或物理屏幕输出 |
| 内存 | `privateBytesSumMiB`，MiB | 各进程私有提交量之和；不是驻留物理内存。另提供工作集总和与观察期采样峰值 |
| CPU | `cpuPercentMachine`，%；`cpuTimeSeconds`，s | 整机容量归一化的平均占用及观察期累计 CPU 时间；100% 表示整机逻辑核满载 |

汇总提供 P50（中位数）和 P90。版本差值统一按 P50 计算：负值表示低于基准，正值表示高于基准；基准为零时变化百分比为 `null`。具体指标的增减方向以 `metricDefinitions` 为准。

预热和失败记录不参与统计，缺失值不填零。内存均值、采样峰值和平均 CPU 先形成每轮结果，再汇总多轮 P50/P90。单样本只用于验证流程；百分比变化本身不等于确认的性能回归。比较不同批次前须核对环境、场景和指标含义。

### 3.4 错误和退出码

| 退出码 | 含义 |
| --- | --- |
| 0 | 测试完成、数据完整且清理成功；或帮助命令成功 |
| 1 | 环境、准备、测量、清理、输出失败，或数据不完整 |
| 2 | 输入错误，包括已有输出目录冲突 |
| 130 | 用户取消或中断；同时清理失败时返回 1 |

错误提供 `code`、`stage` 和 `message`。参数错误时按提示修正；输出目录冲突时使用新目录，不删除或覆盖已有实验。环境不满足时处理提示的问题再重新运行。

`startup:cold`、`startup:all`、`all` 和内部冷启动继续入口返回 `UNSUPPORTED_TEST`，退出码为 2，在环境检查和测量前拒绝。

## 4. 其他文档

- [简明使用说明](PRD.zh-CN.md)：安装、常用命令与结果读取。
- [技术方案](TECHNICAL-DESIGN.zh-CN.md)：计时、采集、执行机制、协议与验收约束。
- [实现与验证记录](IMPLEMENTATION.zh-CN.md)：已完成验证和验证边界。
- [后续待办](../Todo.md)。

结果结构约束见[输出 Schema](output.schema.json)和[样本 Schema](sample.schema.json)。首期不提供 `status`、`resume`、`cancel` 命令，使用本文中的状态文件和停止方式。

## 5. 源码开发补充

源码方式需要 Windows C++ 构建工具，具体要求见[技术方案](TECHNICAL-DESIGN.zh-CN.md#1-运行与分发)。在项目根目录执行：

```powershell
npm ci
npm run build
node .\bin\electron-benchmarks.js --help
```

这部分仅用于源码开发。调试时可将文档中的 `electron-benchmarks` 命令替换为 `node .\bin\electron-benchmarks.js`。
