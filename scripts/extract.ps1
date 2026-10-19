$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$destination = [IO.Path]::GetFullPath($env:BENCH_DESTINATION).TrimEnd('\') + '\'
$archive = [IO.Compression.ZipFile]::OpenRead($env:BENCH_ZIP)
try {
    $total = 0L
    foreach ($entry in $archive.Entries) {
        if ($entry.FullName.Contains(':') -or [IO.Path]::IsPathRooted($entry.FullName)) { throw 'Archive contains an absolute path or alternate data stream' }
        $file = [IO.Path]::GetFullPath([IO.Path]::Combine($destination, $entry.FullName))
        if (-not $file.StartsWith($destination, [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive path escapes destination' }
        if ((($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Archive symlinks are unsupported' }
        $total += $entry.Length
        if ($total -gt 4GB) { throw 'Archive exceeds extraction limit' }
        if ($entry.FullName.EndsWith('/')) { [IO.Directory]::CreateDirectory($file) | Out-Null; continue }
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file)) | Out-Null
        $inputStream = $entry.Open()
        try {
            $outputStream = [IO.File]::Open($file, [IO.FileMode]::CreateNew)
            try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose() }
        } finally { $inputStream.Dispose() }
    }
} finally { $archive.Dispose() }
