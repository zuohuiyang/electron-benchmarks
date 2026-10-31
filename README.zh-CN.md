# electron-benchmarks

[English](README.md) | 简体中文

面向 AI Agent 的非官方 Electron 基准测量 CLI，支持热启动、空闲内存、空闲 CPU，以及单版本测试和多版本对比。第一个目标为基准。

## 安装

支持 Windows 10/11 x64、Node.js >=22.12、Electron >=22。npm 包包含原生辅助程序与测试场景，使用时无需编译。

```powershell
npm install --global electron-benchmarks@0.1.0
electron-benchmarks --help
electron-benchmarks startup --electron 40.0.0
electron-benchmarks memory --electron 40.0.0 --electron 41.0.0 --repeat 3
electron-benchmarks cpu --electron "D:\build\electron.exe" --repeat 3
```

在非管理员终端运行，保持独占、解锁的交互桌面。发布版本自动下载、校验并缓存，本地路径须指向完整可运行的分发目录。热启动默认每个目标预热 5 次、正式测量 20 次；内存和 CPU 各预热 1 次、正式测量 10 次。`--repeat` 修改每个目标的正式次数。

## 输入与范围

`startup` 与 `startup:warm` 等价；`memory`、`cpu` 分别测空闲资源。CLI 与 JSON 使用相同测试名：

```json
{"test":"startup:warm","electrons":["40.0.0","41.0.0"],"repeat":10}
```

```powershell
electron-benchmarks --config benchmark.json
```

JSON 相对路径以配置文件目录为基准，CLI 相对路径以工作目录为基准。版本须精确，不接受 `latest` 或范围。重复 `--electron` 比较多个目标。已移除 `--scenario` 和独立的 `scenario` 字段。

**0.1.0 不提供冷启动。** `startup:cold`、`startup:all`、`all` 和内部冷启动继续入口在准备前明确拒绝。本版不重启系统、不设置测试自启动；其他平台、诊断采集和任务管理留待后续。

## AI 数据消费

stdout 只输出一个 JSON 结果或错误对象，进度与简短摘要写到 stderr。消费前检查 `status`、`dataComplete`、`error`、`cleanupError`、样本量与警告。`--help` 输出纯文本。

默认目录以本机时间命名为 `YYYYMMDD-HHmm-startup`、`...-memory` 或 `...-cpu`；自动重名追加 `-2`、`-3`，显式 `--out` 必须是新目录。归档结构：

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

汇总采用协议 v3，包含完整时间和时区、环境摘要、实际测量条件、目标身份、指标单位、P50/P90、基于 P50 的差值和完整性。stdout 的 `outputDirectory` 用于定位原始目录；迁移后以实际文件位置为准。`artifacts` 相对于 `summary.json` 所在目录，完成后可整体迁移归档。运行 profile 单独存放，任务结束后清理。不生成 HTML。

统计排除预热与失败，缺失值不补零；基准为零时变化百分比为 null。单样本只用于流程验证。启动指标分别为 Electron 初始化就绪和首次可见视频回调，不代表页面可交互或物理屏幕输出。内存私有提交量不是驻留物理内存，工作集求和可能重复计算共享页；CPU 按整机逻辑核容量归一化。

```powershell
node "$(npm root --global)\electron-benchmarks\examples\read-results.mjs" "<结果目录>\summary.json"
```

用 Ctrl+C 或创建 `detail/STOP` 停止当前任务。退出码：0 完整完成且清理成功，1 执行或输出失败，2 输入错误或测试未提供，130 主动中断。stderr 有内容不表示失败。参见[配置 Schema](docs/config.schema.json)、[输出 v3](docs/output.schema.json)、[样本 v1](docs/sample.schema.json)、[用户说明](docs/USER-GUIDE.zh-CN.md)和[技术方案](docs/TECHNICAL-DESIGN.zh-CN.md)。

## 开发

```powershell
npm ci
npm run build
node ./bin/electron-benchmarks.js --help
npm test
npm pack
```

源码构建需要 Visual Studio C++ x64 工具链。自动化测试不运行真实基准或修改系统设置。详见[验证记录](docs/IMPLEMENTATION.zh-CN.md)、[PRD](docs/PRD.zh-CN.md)、[待办](Todo.md)和[代码与素材来源](THIRD_PARTY_NOTICES.md)。命令和配置形式参考 Chromium Crossbench。本项目为独立社区项目，与 Electron 官方无隶属关系。
