# electron-benchmarks PRD / 简明使用说明

版本：0.1.0 · 更新日期：2026-10-31

本文介绍 0.1.0 的安装、常用输入输出和使用方式。取消、异常处理及详细字段说明见[详细用户说明](USER-GUIDE.zh-CN.md)，实现原理见[技术方案](TECHNICAL-DESIGN.zh-CN.md)。

本版提供热启动、内存和 CPU 测试。冷启动及包含冷启动的组合入口留待后续版本。

## 1. 产品用途

`electron-benchmarks` 是面向 AI Agent 的 Electron 基准测量 CLI，也支持人工操作。它测量 Electron 自身的启动速度、内存和 CPU，支持单版本测试与同一机器上的多版本对比。命令和配置形式参考 Chromium [Crossbench](https://chromium.googlesource.com/crossbench/+/HEAD/README.md)。

项目名、npm 包名和 CLI 命令均为 `electron-benchmarks`，源码入口为 `bin/electron-benchmarks.js`。输入使用 CLI 参数或 JSON 配置，输出结构化数据；结果对应固定测试场景，不直接代表业务应用的表现。

## 2. 安装与运行

支持 Windows 10/11 x64、Node.js 22.12 或更新版本、Electron 22 或更新版本。使用非管理员终端，保持桌面解锁，只保留一个登录会话，测量期间避免其他测试或编译负载。

```powershell
npm install --global electron-benchmarks
electron-benchmarks --help
```

安装包包含运行所需文件，无需自行编译。安装后可以在任意工作目录使用 `electron-benchmarks`。

本文示例统一使用安装后的 `electron-benchmarks` 命令。源码运行方式见[详细说明](USER-GUIDE.zh-CN.md#5-源码开发补充)。

## 3. 输入

### 3.1 选择测试

CLI 测试参数与 JSON 的 `test` 字段使用相同的 `测试名:场景` 写法：

| 输入 | 执行内容 | 是否重启 |
| --- | --- | --- |
| `startup` / `startup:warm` | 热启动 | 否 |
| `memory` | 单窗口空闲内存 | 否 |
| `cpu` | 单窗口空闲 CPU | 否 |

### 3.2 常用命令

`--electron` 支持精确发布版本号和本地构建路径，可混用。一个目标输出单版本结果，多个目标输出对比结果，第一个目标为基准。发布版本自动下载并缓存，本地路径直接使用。

```powershell
# 单版本热启动
electron-benchmarks startup --electron 40.0.0

# 多版本对比
electron-benchmarks startup --electron 40.0.0 --electron 41.0.0 --repeat 10

# 发布版本与本地构建混用
electron-benchmarks memory --electron 40.0.0 --electron "D:\builds\candidate\electron.exe" --repeat 3

# CPU
electron-benchmarks cpu --electron 40.0.0 --repeat 3
```

### 3.3 参数与默认值

| 参数 | 默认值 | 用途 |
| --- | --- | --- |
| `--electron` | 无，必填 | 版本号或完整本地构建中的 `electron.exe` 路径；可重复 |
| `--repeat` | 热启动 20 次；内存、CPU 各 10 次 | 每个目标、每项测试的正式测量次数，不含预热 |
| `--out` | 当前账户的 `%LOCALAPPDATA%\ElectronBenchmarks\runs\YYYYMMDD-HHmm-测试名` | 指定结果目录 |
| `--config` | 不读取配置文件 | 从 JSON 读取完整测试配置 |
| `--help` | 不启用 | 显示用法 |

显式传入 `--repeat 3` 时，所选的每个目标、每项测试各测 3 次。

### 3.4 JSON 配置

保存为 `benchmark.json`：

```json
{
  "test": "startup:warm",
  "electrons": ["40.0.0", "41.0.0"],
  "repeat": 10,
  "out": "./results/startup-comparison"
}
```

```powershell
electron-benchmarks --config .\benchmark.json
```

JSON 与 CLI 使用相同的测试名和参数含义，`electrons` 顺序决定基准。配置中的相对路径以配置文件目录为基准。

## 4. 版本范围

0.1.0 暂不开放 `startup:cold`、`startup:all` 和 `all`，调用时提示尚未支持。本版不重启系统或设置测试自启动。

## 5. 输出

工具在终端显示结果位置。默认目录名为 `YYYYMMDD-HHmm-测试名`，使用本机时区、精确到分钟；同分钟同类测试重名时追加 `-2`、`-3`。所有启动场景的目录测试名统一为 `startup`，具体场景和完整时间保存在汇总中。

结果根目录只保留两个入口：

```text
20261031-1530-startup/
  summary.json
  detail/
```

| 输出 | 内容 |
| --- | --- |
| `summary.json` / stdout | 测试状态、环境摘要、实际测量条件、目标与基准、指标、版本差值、样本数量和完整性 |
| `detail/` | 完整环境、执行计划、状态文件、逐次样本和日志 |
| stderr | 进度、交互提示和简短终端摘要 |

AI 默认先读 `summary.json`，确认 `status` 为 `complete`、`dataComplete` 为 `true`，核对样本量后使用指标。汇总提供 P50/P90，版本差值统一按 P50 计算；指标单位与含义见 `metricDefinitions`。

需要复核时，通过 `artifacts` 读取详细文件，引用路径相对于本次结果目录。测试结束后可以整体迁移结果目录，运行文件由工具另行管理。具体字段和读取示例见[详细用户说明](USER-GUIDE.zh-CN.md#3-详细输出与数据消费)。

## 6. 进一步阅读

- [详细用户说明](USER-GUIDE.zh-CN.md)：参数边界、取消与异常处理、结果字段和退出码。
- [技术方案](TECHNICAL-DESIGN.zh-CN.md)：测量原理与实现约束。
- [实现与验证记录](IMPLEMENTATION.zh-CN.md)：已完成验证和验证边界。
