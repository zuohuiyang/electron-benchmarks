# Windows 自动登录辅助工具

`autologon.ps1` 独立管理自动登录相关操作，支持 Windows PowerShell 5.1 和 PowerShell 7。主测试流程只调用 `status`；配置操作由用户单独执行。此目录不包含 benchmark CLI。

## 检查（只读，无需主动提权）

```powershell
powershell.exe -NoProfile -File .\tools\windows\autologon.ps1 status
powershell.exe -NoProfile -File .\tools\windows\autologon.ps1 status -Json
```

也可将示例中的 `powershell.exe` 换成 `pwsh.exe`。如果本机执行策略阻止运行脚本，应遵循本机管理要求使用允许的执行方式；本工具不会修改执行策略。

只打开本机 Winlogon 注册表项的只读句柄，读取 `AutoAdminLogon`、`DefaultUserName`、`DefaultDomainName`。64 位系统使用 64 位注册表视图。不会读取密码、枚举注册表值或访问 LSA secret，也不会下载、启动程序或更改设置。JSON 包含账户名和域名，归档时请按环境信息处理。

JSON 示例（仅为示例）：

```json
{"schemaVersion":1,"state":"configured","configured":true,"userName":"bench","domain":"BENCH-PC","credentialValidity":"notChecked","passwordStorage":"notInspected","message":"Automatic-logon flag and user name are present. Credentials and successful sign-in are not verified."}
```

| `state` | 含义 | `configured` |
| --- | --- | --- |
| `configured` | 标志为 `1` 且用户名非空，仅表示存在配置迹象 | `true` |
| `notConfigured` | 标志不存在、为空或为 `0` | `false` |
| `incomplete` | 标志为 `1`，用户名为空 | `false` |
| `unknown` | 读取失败或标志值无法识别 | `null` |

退出码 `0` 表示完成检查（包括未配置或不完整），`2` 表示无法判断或调用错误。不要把退出码 `0` 当成已配置。缺失的域名不会单独判为未配置，因为本地账户也可使用自动登录。`credentialValidity` 始终为 `notChecked`，`passwordStorage` 始终为 `notInspected`。没有发现明文密码不是此工具的判断条件；配置迹象也不能证明密码存在、有效或账户有登录权限。

## 启用或关闭（用户交互）

1. 从 [微软 Sysinternals Autologon 官方页面](https://learn.microsoft.com/en-us/sysinternals/downloads/autologon) 手动下载并解压到本机目录（建议放在仓库外）。按系统架构选择 `Autologon.exe`、`Autologon64.exe` 或 `Autologon64a.exe`。
2. 显式传入路径。脚本不搜索 PATH、不自动下载，不在仓库中携带二进制；打开前检查文件名及有效的 Microsoft Corporation Authenticode 签名。签名无法验证时停止，请检查来源和系统信任状态，不绕过验证。
3. 脚本请求 UAC 提权并等待官方程序退出；根据提示接受官方 EULA，在界面中自行输入凭据、点击 **Enable** 或 **Disable**，然后关闭界面。

```powershell
powershell.exe -NoProfile -File .\tools\windows\autologon.ps1 enable -AutologonPath 'C:\Tools\Autologon\Autologon64.exe'
powershell.exe -NoProfile -File .\tools\windows\autologon.ps1 disable -AutologonPath 'C:\Tools\Autologon\Autologon64.exe'
```

两个动作打开的是同一个官方界面；脚本只提示期望操作，不会自动点击按钮，也不能约束用户实际选择。脚本没有密码参数、不传命令行凭据、不写配置或日志、不直接写注册表。关闭界面后重新显示只读状态。此时退出码 `0` 仅表示界面进程已退出及检查已尝试，**不表示请求的操作完成**；取消界面、没有点击按钮也可能返回 `0`。路径、签名、启动或 UAC 失败返回 `2`。重新运行 `status -Json` 可以核对配置迹象，但实际自动登录是否成功仍需用户在另行安排的启动中确认。本脚本不重启电脑。

## 主测试流程接入示例

未来 Runner 可以启动独立 PowerShell 子进程并解析 stdout 中的单个 JSON 对象：

```powershell
$raw = & powershell.exe -NoProfile -File .\tools\windows\autologon.ps1 status -Json
$checkExitCode = $LASTEXITCODE
if ($checkExitCode -ne 0) {
    Write-Warning '无法判断自动登录配置；可以每次重启后手动登录继续测试。'
}
else {
    $status = $raw | ConvertFrom-Json
    if ($status.configured -ne $true) {
        Write-Warning '未检测到完整的自动登录配置。可单独运行 tools/windows/autologon.ps1 enable -AutologonPath <官方工具路径>，或每次重启后手动登录继续测试。'
    }
}
# 继续原有测试准备/恢复流程，不在这里调用 enable 或 disable。
```

自动登录属于用户管理的机器配置，不随一次测试结束自动关闭。任务期间的临时测试自启动由 Runner 单独管理和清理。此脚本不创建计划任务、不设置测试自启动、不修改优先级。没有自动登录时，主流程支持每次重启后由用户手动登录，再继续本轮测试。即使 `configured=true`，也允许手动登录，不承诺无人值守一定成功。

## 能力与限制

[微软 Autologon 文档](https://learn.microsoft.com/en-us/sysinternals/downloads/autologon)说明：密码存放在 LSA secret 中，管理员仍可恢复它；工具不验证提交的凭据或账户登录权限。因此请只在受控测试机器上自行决定是否启用。

[微软 Windows 自动登录说明](https://learn.microsoft.com/en-us/troubleshoot/windows-server/user-profiles-and-logon/turn-on-automatic-logon)列出策略、登录横幅、网络及域登录等限制。此脚本不审计或更改这些策略，也不验证目标账户是否为当前测试账户；Runner 应按测试需求核对 `userName` / `domain`。关闭自动登录后的状态检查只能报告开关迹象，不能证明所有既有凭据都已清除。关于 LSA secret 与 Winlogon 明文密码的关系，见[微软密码保护说明](https://learn.microsoft.com/en-us/windows/win32/secauthn/protecting-the-automatic-logon-password)。

## 安全验证

```powershell
powershell.exe -NoProfile -File .\tools\windows\tests\autologon.Tests.ps1
```

测试用内存中的模拟证据覆盖状态分类，并模拟文件、签名和进程启动检查交互入口；不会运行官方程序、提权、写注册表或重启。实际只读检查可另运行 `status -Json`。真实 Enable/Disable 操作需用户另行手动验证。
