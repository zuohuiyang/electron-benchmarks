#requires -Version 5.1
<#
.SYNOPSIS
Read automatic-logon configuration or open Microsoft's interactive Autologon UI.
.EXAMPLE
powershell.exe -NoProfile -File .\tools\windows\autologon.ps1 status -Json
.EXAMPLE
powershell.exe -NoProfile -File .\tools\windows\autologon.ps1 enable -AutologonPath C:\Tools\Autologon64.exe
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('status', 'enable', 'disable')]
    [string] $Action = 'status',
    [switch] $Json,
    [string] $AutologonPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-WinlogonEvidence {
    # Explicit native registry view also works in a 32-bit PowerShell process.
    $base = $null
    $key = $null
    try {
        $view = [Microsoft.Win32.RegistryView]::Registry32
        if ([Environment]::Is64BitOperatingSystem) {
            $view = [Microsoft.Win32.RegistryView]::Registry64
        }
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
            [Microsoft.Win32.RegistryHive]::LocalMachine, $view)
        $key = $base.OpenSubKey('SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon', $false)
        if ($null -eq $key) { throw 'Winlogon key unavailable.' }
        # Never enumerate values or access DefaultPassword / LSA secrets.
        $options = [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
        [pscustomobject]@{
            AutoAdminLogon = $key.GetValue('AutoAdminLogon', $null, $options)
            UserName = $key.GetValue('DefaultUserName', $null, $options)
            Domain = $key.GetValue('DefaultDomainName', $null, $options)
        }
    }
    finally {
        if ($null -ne $key) { $key.Dispose() }
        if ($null -ne $base) { $base.Dispose() }
    }
}

function Get-AutologonStatus {
    $result = [ordered]@{
        schemaVersion = 1
        state = 'unknown'
        configured = $null
        userName = $null
        domain = $null
        credentialValidity = 'notChecked'
        passwordStorage = 'notInspected'
        message = 'Unable to read automatic-logon configuration. Manual sign-in remains available.'
    }
    try {
        $evidence = Get-WinlogonEvidence
        $result.userName = $evidence.UserName
        $result.domain = $evidence.Domain
        $flag = [string] $evidence.AutoAdminLogon
        if ($flag -eq '1') {
            if ([string]::IsNullOrWhiteSpace([string] $evidence.UserName)) {
                $result.state = 'incomplete'
                $result.configured = $false
                $result.message = 'Automatic logon is enabled but DefaultUserName is missing. Use the separate helper to review configuration, or sign in manually.'
            }
            else {
                $result.state = 'configured'
                $result.configured = $true
                $result.message = 'Automatic-logon flag and user name are present. Credentials and successful sign-in are not verified.'
            }
        }
        elseif ($flag -eq '' -or $flag -eq '0') {
            $result.state = 'notConfigured'
            $result.configured = $false
            $result.message = 'Automatic logon is not enabled. Run this helper separately with enable, or sign in manually after each restart.'
        }
        else {
            $result.message = 'AutoAdminLogon has an unrecognized value. Review with the separate helper, or sign in manually.'
        }
    }
    catch {
        # Do not include arbitrary registry data or exception details in output.
    }
    [pscustomobject] $result
}

function Open-AutologonDialog {
    param([string] $Path)
    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw 'Supply -AutologonPath pointing to an extracted executable from https://learn.microsoft.com/en-us/sysinternals/downloads/autologon . No download is performed.'
    }
    $file = Get-Item -LiteralPath $Path -ErrorAction Stop
    if ($file.PSIsContainer -or $file.Extension -ne '.exe') {
        throw 'AutologonPath must be a local Autologon executable.'
    }
    if ($file.FullName.StartsWith('\\')) { throw 'Use a local copy of the official executable.' }
    if ($file.Name -notmatch '^Autologon(64|64a)?\.exe$') {
        throw 'Expected Autologon.exe, Autologon64.exe, or Autologon64a.exe.'
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or
        $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)') {
        throw 'The executable must have a valid Microsoft Corporation Authenticode signature.'
    }
    # No credentials, command arguments, EULA acceptance, registry writes, or reboot.
    Start-Process -FilePath $file.FullName -Verb RunAs -Wait -ErrorAction Stop | Out-Null
}

# Dot sourcing is reserved for read-only unit tests of the functions above.
if ($MyInvocation.InvocationName -eq '.') { return }

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'This helper supports Windows only.'
    }
    if ($Action -eq 'status') {
        if ($AutologonPath) { throw '-AutologonPath is only used with enable or disable.' }
        $status = Get-AutologonStatus
        if ($Json) { $status | ConvertTo-Json -Compress }
        else { $status | Format-List }
        if ($status.state -eq 'unknown') { exit 2 }
        exit 0
    }
    if ($Json) { throw '-Json is only supported for the read-only status action.' }
    Write-Host "Opening Microsoft Autologon. In its dialog, click $Action yourself; close it when finished. Accept any EULA/UAC prompt only if you intend to proceed."
    Open-AutologonDialog -Path $AutologonPath
    Write-Host 'The dialog process has closed. This does not confirm that you clicked Enable/Disable or that credentials work.'
    Get-AutologonStatus | Format-List
    exit 0
}
catch {
    Write-Error $_ -ErrorAction Continue
    exit 2
}
