#requires -Version 5.1
# Standalone tests: no Pester dependency, no system configuration changes.
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\..\autologon.ps1"

function Assert-Equal($Actual, $Expected, [string] $Label) {
    if ($Actual -cne $Expected) { throw "Assertion failed: $Label (expected '$Expected', got '$Actual')" }
}

# Replace the only registry reader before exercising status logic.
function Get-WinlogonEvidence {
    if ($script:ReadFails) { throw 'Simulated access denied' }
    [pscustomobject]@{
        AutoAdminLogon = $script:Flag
        UserName = $script:User
        Domain = $script:Domain
    }
}
$script:ReadFails = $false
$script:Domain = $null
$cases = @(
    @{ Flag = '1'; User = 'bench'; State = 'configured'; Configured = $true },
    @{ Flag = 1; User = 'bench'; State = 'configured'; Configured = $true },
    @{ Flag = '1'; User = ''; State = 'incomplete'; Configured = $false },
    @{ Flag = '1'; User = ' '; State = 'incomplete'; Configured = $false },
    @{ Flag = '0'; User = 'bench'; State = 'notConfigured'; Configured = $false },
    @{ Flag = $null; User = $null; State = 'notConfigured'; Configured = $false },
    @{ Flag = ''; User = 'bench'; State = 'notConfigured'; Configured = $false },
    @{ Flag = 'unexpected'; User = 'bench'; State = 'unknown'; Configured = $null }
)
foreach ($case in $cases) {
    $script:Flag = $case.Flag
    $script:User = $case.User
    $result = Get-AutologonStatus
    Assert-Equal $result.state $case.State 'state classification'
    Assert-Equal $result.configured $case.Configured 'configured evidence'
    Assert-Equal $result.credentialValidity 'notChecked' 'no credential validation'
    Assert-Equal $result.passwordStorage 'notInspected' 'no password inspection'
    $roundtrip = $result | ConvertTo-Json -Compress | ConvertFrom-Json
    Assert-Equal $roundtrip.state $case.State 'JSON roundtrip'
}
$script:ReadFails = $true
$result = Get-AutologonStatus
Assert-Equal $result.state 'unknown' 'access failure'
Assert-Equal $result.configured $null 'access failure does not imply disabled'

# Replace filesystem/signature/process commands. A real UI is never launched.
function Get-Item {
    param($LiteralPath, $ErrorAction)
    [pscustomobject]@{
        FullName = $LiteralPath
        Name = $script:FileName
        Extension = '.exe'
        PSIsContainer = $false
    }
}
function Get-AuthenticodeSignature {
    param($LiteralPath)
    [pscustomobject]@{
        Status = $script:SignatureStatus
        SignerCertificate = [pscustomobject]@{ Subject = $script:Signer }
    }
}
function Start-Process {
    param($FilePath, $Verb, [switch] $Wait, $ErrorAction)
    Assert-Equal $FilePath 'C:\Tools\Autologon64.exe' 'explicit executable path'
    Assert-Equal $Verb 'RunAs' 'elevation requested for UI only'
    Assert-Equal $Wait.IsPresent $true 'wait for UI'
    Assert-Equal $args.Count 0 'no extra arguments or credentials'
    $script:LaunchCount++
}
$script:FileName = 'Autologon64.exe'
$script:SignatureStatus = 'Valid'
$script:Signer = 'CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US'
$script:LaunchCount = 0
Open-AutologonDialog -Path 'C:\Tools\Autologon64.exe'
Assert-Equal $script:LaunchCount 1 'official UI launch'

function Assert-Rejected([string] $Path) {
    $rejected = $false
    try { Open-AutologonDialog -Path $Path } catch { $rejected = $true }
    Assert-Equal $rejected $true 'unsafe or missing executable rejected'
    Assert-Equal $script:LaunchCount 1 'rejected executable never launched'
}
Assert-Rejected ''
Assert-Rejected '\\server\share\Autologon64.exe'
$script:SignatureStatus = 'NotSigned'
Assert-Rejected 'C:\Tools\Autologon64.exe'
$script:SignatureStatus = 'Valid'
$script:Signer = 'CN=Other Publisher, O=Other Publisher, C=US'
Assert-Rejected 'C:\Tools\Autologon64.exe'
$script:Signer = 'CN=Microsoft Corporation, O=Microsoft Corporation Fake, C=US'
Assert-Rejected 'C:\Tools\Autologon64.exe'
$script:FileName = 'different.exe'
Assert-Rejected 'C:\Tools\different.exe'

Write-Output 'PASS: 8 status cases, read failure, JSON roundtrips, UI launch contract and 6 rejection cases. No system settings changed.'
