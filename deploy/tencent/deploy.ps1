[CmdletBinding()]
param(
    [string]$SshHost = 'tencent-lighthouse',
    [string]$Revision,
    [string]$AdminEmail = 'admin@rdesign.local',
    [string]$AdminName = 'R-Design Administrator',
    [string]$ReuseRevision = 'none',
    [switch]$StageRemote,
    [switch]$VerifyRemote,
    [switch]$Publish
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$privateDirectory = Join-Path $repository '.rdesign/deployment'
$accessPath = Join-Path $privateDirectory 'team-access.txt'
$sshOptions = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ClearAllForwardings=yes', '-o', 'ConnectTimeout=15')
if ($SshHost -notmatch '^[A-Za-z0-9._-]+$') { throw 'SSH host must be an existing safe alias.' }
if ($AdminEmail -notmatch '^[A-Za-z0-9_.+@-]{3,200}$') { throw 'Invalid administrator email.' }
if ($AdminName -notmatch '^[A-Za-z0-9 _.-]{1,80}$') { throw 'Invalid administrator name.' }
if ($Publish -and ($StageRemote -or $VerifyRemote)) { throw 'Publish and staging verification are separate operations.' }
if ($ReuseRevision -ne 'none' -and $ReuseRevision -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$') { throw 'Unsafe dependency reuse revision.' }

function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE" }
}

function Protect-PrivateFile([string]$Path) {
    if ($env:OS -eq 'Windows_NT') {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        & icacls.exe $Path /inheritance:r /grant:r "${identity}:(F)" '*S-1-5-18:(F)' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not restrict private deployment file permissions.' }
    } else {
        Invoke-Checked 'chmod' @('600', $Path)
    }
}

Push-Location $repository
try {
    $head = (& git rev-parse --short=12 HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'A Git checkout is required to prepare a release.' }
    if (-not $Revision) { $Revision = $head + '-' + (Get-Date -Format 'yyyyMMddHHmmss') }
    if ($Revision -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$') { throw 'Unsafe release revision.' }
    $hasStaticBuild = Test-Path -LiteralPath 'dist/workbench/index.html'
    if (-not $hasStaticBuild -and -not ($StageRemote -or $VerifyRemote)) { throw 'Run the validated production frontend build before preparing a release.' }
    if ($Publish -and -not (Test-Path -LiteralPath 'apps/team-server/src/index.ts')) { throw 'Team server source is missing.' }
    & git check-ignore --quiet '.rdesign/deployment/team-access.txt'
    if ($LASTEXITCODE -ne 0) { throw 'Deployment credentials must be Git ignored.' }
    New-Item -ItemType Directory -Path $privateDirectory -Force | Out-Null
    $utf8 = New-Object Text.UTF8Encoding($false)
    if (Test-Path -LiteralPath $accessPath) {
        $access = [IO.File]::ReadAllText($accessPath) | ConvertFrom-Json
        if ($access.password -notmatch '^[A-Za-z0-9_-]{32,128}$') { throw 'Existing credential file has an unexpected format; preserve it and review manually.' }
    } else {
        $random = New-Object byte[] 36
        $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $generator.GetBytes($random) } finally { $generator.Dispose() }
        $password = [Convert]::ToBase64String($random).TrimEnd('=').Replace('+', '-').Replace('/', '_')
        $access = [pscustomobject]@{
            url = 'https://175.178.16.90/r-design/team'
            email = $AdminEmail
            password = $password
            name = $AdminName
            createdAt = [DateTimeOffset]::Now.ToString('o')
            revision = $Revision
            status = 'prepared'
            note = 'Initial administrator only. Existing server administrators are never reset.'
        }
        [IO.File]::WriteAllText($accessPath, ($access | ConvertTo-Json), $utf8)
    }
    Protect-PrivateFile $accessPath
    # Enumerate version-controlled and explicitly scoped new source, never arbitrary workspace files.
    $files = @(& git -c core.quotepath=false ls-files --cached --others --exclude-standard -- .gitattributes package.json package-lock.json tsconfig.json vitest.config.ts playwright.config.ts playwright.team.config.ts apps packages fixtures tests scripts deploy/tencent)
    if ($LASTEXITCODE -ne 0) { throw 'Could not enumerate release source.' }
    $files = @($files | Sort-Object -Unique | Where-Object {
        $_ -notmatch '(^|/)(\.git|\.rdesign|node_modules|dist|__pycache__)(/|$)' -and
        $_ -notmatch '(^|/)\.env(?:\.|$)' -and
        $_ -notmatch '(^|/)(\.npmrc|\.yarnrc(?:\.yml)?|\.ssh)(/|$)' -and
        $_ -notmatch '\.(?:pem|key|crt|p12|pfx)$'
    })
    foreach ($file in $files) {
        if ($file -match '[\r\n]' -or $file.StartsWith('/') -or $file -match '(^|/)\.\.(/|$)') { throw 'Unsafe release filename.' }
        $item = Get-Item -LiteralPath (Join-Path $repository $file)
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Release source must not contain symlinks.' }
    }
    if ($hasStaticBuild) { $files += 'dist/workbench' }
    $manifest = Join-Path $privateDirectory "$Revision.manifest.txt"
    $archive = Join-Path $privateDirectory "r-design-team-$Revision.tar.gz"
    $signaturePath = Join-Path $privateDirectory "$Revision.source.sha256"
    $signatureLines = New-Object 'System.Collections.Generic.List[string]'
    $signatureFiles = @($files | Where-Object { $_ -ne 'dist/workbench' })
    if ($hasStaticBuild) {
        $signatureFiles += @(Get-ChildItem -LiteralPath 'dist/workbench' -Recurse -File | ForEach-Object {
            $_.FullName.Substring($repository.Length + 1).Replace('\', '/')
        })
    }
    foreach ($file in ($signatureFiles | Sort-Object -Unique)) {
        $signatureLines.Add($file + ':' + (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash)
    }
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        $sourceSignature = [BitConverter]::ToString($hasher.ComputeHash($utf8.GetBytes(($signatureLines -join "`n")))).Replace('-', '').ToLowerInvariant()
    } finally { $hasher.Dispose() }
    [IO.File]::WriteAllLines($manifest, [string[]]$files, $utf8)
    if (Test-Path -LiteralPath $archive) {
        if (-not (Test-Path -LiteralPath $signaturePath) -or [IO.File]::ReadAllText($signaturePath).Trim() -ne $sourceSignature) {
            throw 'Source changed after this revision was prepared. Use a new release revision.'
        }
    } else {
        Invoke-Checked 'tar' @('-czf', $archive, '-T', $manifest)
        [IO.File]::WriteAllText($signaturePath, $sourceSignature + "`n", $utf8)
    }
    $archiveSha = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    $access.revision = $Revision
    [IO.File]::WriteAllText($accessPath, ($access | ConvertTo-Json), $utf8)
    Protect-PrivateFile $accessPath
    Write-Output "Prepared revision=$Revision archive=$archive sha256=$archiveSha"
    Write-Output "Private access record: $accessPath"
    if (-not ($Publish -or $StageRemote -or $VerifyRemote)) {
        Write-Output 'Preparation only. No application service or nginx configuration was changed.'
        return
    }

    $remoteArchive = "/tmp/r-design-team-$Revision.tar.gz"
    $remoteInstaller = "/tmp/r-design-team-$Revision.install.sh"
    Invoke-Checked 'scp' ($sshOptions + @($archive, "${SshHost}:$remoteArchive"))
    Invoke-Checked 'scp' ($sshOptions + @((Join-Path $PSScriptRoot 'install.sh'), "${SshHost}:$remoteInstaller"))
    $environmentText = @(
        'RDESIGN_TEAM_PORT=4315'
        'RDESIGN_TEAM_HOST=127.0.0.1'
        'RDESIGN_TEAM_DATA_DIR=/var/lib/r-design-team'
        'RDESIGN_TEAM_PUBLIC_ORIGIN=https://175.178.16.90'
        'RDESIGN_TEAM_BASE_PATH=/r-design'
        'RDESIGN_TEAM_STATIC_DIR=/srv/r-design-team/current/dist/workbench'
        ('RDESIGN_TEAM_ADMIN_EMAIL=' + $access.email)
        ('RDESIGN_TEAM_ADMIN_PASSWORD=' + $access.password)
        ('RDESIGN_TEAM_ADMIN_NAME=' + $access.name)
    ) -join "`n"
    # Secret values travel in stdin, never SSH arguments, shell command text, or console output.
    $phase = if ($Publish) { 'publish' } elseif ($VerifyRemote) { 'verify' } else { 'stage' }
    $remoteCommand = "sudo -n bash $remoteInstaller $Revision $remoteArchive $archiveSha $phase $ReuseRevision"
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = (Get-Command ssh).Source
    $start.Arguments = (($sshOptions + @($SshHost)) -join ' ') + ' "' + $remoteCommand + '"'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    # PowerShell 5 creates its redirected writer from Console.InputEncoding and can emit a BOM at Start.
    $previousInputEncoding = [Console]::InputEncoding
    try {
        [Console]::InputEncoding = $utf8
        if (-not $process.Start()) { throw 'Could not start secure SSH deployment.' }
    } finally {
        [Console]::InputEncoding = $previousInputEncoding
    }
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    # Keep credentials as BOM-free UTF-8 bytes and close the underlying stream directly.
    $inputStream = $process.StandardInput.BaseStream
    if ($Publish) {
        $inputBytes = $utf8.GetBytes($environmentText + "`n")
        $inputStream.Write($inputBytes, 0, $inputBytes.Length)
    }
    $inputStream.Flush()
    $inputStream.Close()
    if (-not $process.WaitForExit(1800000)) { $process.Kill(); throw 'Remote operation timed out; inspect its state before retrying.' }
    $output = $stdout.Result + $stderr.Result
    $output = $output.Replace([string]$access.password, '[redacted]')
    if ($output) { Write-Output $output.TrimEnd() }
    if ($process.ExitCode -ne 0) { throw "Remote deployment failed with exit code $($process.ExitCode)." }
    $access.status = if ($Publish) { 'deployed' } elseif ($VerifyRemote) { 'linux-verified' } else { 'staged' }
    [IO.File]::WriteAllText($accessPath, ($access | ConvertTo-Json), $utf8)
    Protect-PrivateFile $accessPath
    Invoke-Checked 'ssh' ($sshOptions + @($SshHost, "rm -f -- $remoteInstaller $remoteArchive"))
    if ($Publish) { Write-Output "Deployed URL: $($access.url)" } else { Write-Output "Inactive release: /srv/r-design-team/releases/$Revision" }
} finally {
    Pop-Location
}
