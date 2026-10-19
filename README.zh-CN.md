# Electron Benchmarks

[English](README.md) | 简体中文

非官方、可复现的 Electron 性能基准测试套件，用于评估 Electron 自身的性能与版本回归。

本项目为独立社区项目，与 Electron 官方无隶属关系，也未经官方背书。

## 项目定位

通过固定标准场景，测量 Electron 的启动时间、内存、CPU 等指标，帮助开发者了解不同版本的性能表现，发现性能回归并验证优化效果。

已实现首期 Windows CLI。完整实体机冷启动重启链路仍待验证，开发期间的流程验证数据不作为公开性能结论。

## 构建与使用

支持 Windows 10/11 x64、Node.js 22.12 或更新版本、Electron 22 或更新版本。源码构建需要 Visual Studio C++ x64 工具链。npm 分发包包含编译后的原生辅助程序，目前尚未发布到 npm。

```powershell
npm ci
npm run build
node ./bin/electron-bench.js --help

# 热启动，默认每个目标预热 5 次、正式测量 20 次
node ./bin/electron-bench.js startup --electron "D:\build\electron.exe"

# 多版本对比，第一个目标为基准
node ./bin/electron-bench.js startup --electron 40.0.0 --electron 41.0.0 --repeat 10

node ./bin/electron-bench.js memory --electron "D:\build\electron.exe" --repeat 3
node ./bin/electron-bench.js cpu --electron "D:\build\electron.exe" --repeat 3
```

请使用非管理员终端，并保持独占、解锁的交互桌面。版本号自动下载并缓存，本地路径直接使用。目标路径应位于完整分发目录或具有运行资产的 GN 构建目录；指纹只包含运行资产，不扫描编译中间文件与符号。

## 冷启动与全部测试

```powershell
node ./bin/electron-bench.js startup --electron "D:\build\electron.exe" --scenario cold --repeat 10
node ./bin/electron-bench.js all --electron "D:\build\electron.exe" --repeat 3
```

以上命令在交互确认后会重启 Windows。`all` 顺序为冷启动、热启动、内存、CPU。每个冷样本单独重启并登录，通过当前用户 HKCU Run 启动项继续，不使用计划任务。主流程只检查自动登录，未配置时可手动登录，也可单独使用 [Windows 辅助工具](tools/windows/README.md)。

冷启动输出目录须在工具安装目录之外，默认位于 `%LOCALAPPDATA%/ElectronBenchmarks/runs/`。工具、依赖和 Node 可执行文件固定到该目录的 `tool/`。任务期间不要移动或修改输出、工具副本和被测构建。

每轮开机至少等待 120 秒，总 CPU 连续 3 次不超过 10%，间隔 2 秒，最长等待 20 分钟。控制器与 Electron 主进程优先级要求 CPU Normal、IO 2、内存 5。每次重启前倒计时 15 秒，可用 `Ctrl+C` 或在结果目录创建 `STOP` 空文件停止；不强制关闭其他应用。结束或停止后清理本任务自启动，不修改自动登录。

意外中断不会断点续测。后续启动处理残留状态；等待重启的任务可通过创建 `STOP` 后再次调用 CLI 清理。清理失败会显示具体注册表项，残留设置不会重新开始已结束的测试。

## 配置与结果

```powershell
node ./bin/electron-bench.js --config ./examples/benchmark.json
```

参见 [配置示例](examples/benchmark.json) 和 [JSON Schema](docs/config.schema.json)。配置文件中的相对路径以配置文件所在目录为基准，不与测试 CLI 参数混用。

输出包括 `report.html`、`summary.json`、固定计划 `plan.json`、运行状态 `run.json`、逐次样本和环境记录。失败和预热样本保留，不混入正式 P50/P90。APP READY 与视频回调均从父进程发起启动前起算；视频回调不代表物理屏幕输出。

资源测试使用静态页面，静置 10 秒、观察 20 秒、每秒采样。私有提交量不是私有驻留物理内存，工作集总和可能重复计算共享页；CPU 使用 Windows 进程累计 CPU 时间差，按全部逻辑核归一化，不直接采用 Electron 的百分比读数。虚拟机来宾重启不能验收实体机冷启动表现。

```powershell
npm test
powershell.exe -NoProfile -File ./tools/windows/tests/autologon.Tests.ps1
npm pack
```

测试不会重启或修改系统配置。详见 [实现与验证记录](docs/IMPLEMENTATION.zh-CN.md)、[PRD](docs/PRD.zh-CN.md)、[后续待办](Todo.md) 和 [代码与素材来源](THIRD_PARTY_NOTICES.md)。

## 测试模式

- **单版本测试**：运行固定标准场景，输出该版本的测量指标、原始样本和环境信息。
- **多版本对比**：在相同环境下，对多个 Electron 版本运行相同标准场景。支持指定基准版本，输出各版本的测量指标、相对基准的绝对差值和变化百分比。

## 基本结构

标准场景定义测试内容，共用 Runner 负责运行场景和采集数据，Reporter 负责输出测量结果及版本对比报告。

配置、重复测试和报告设计参考 Chromium Crossbench。

## 初期范围

第一阶段聚焦 Windows 上 Electron 自身的标准性能测试，不扩展为测试任意用户应用的通用平台。
