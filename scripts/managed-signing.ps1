# Contract shared with SigningStore.cs. Never write passwords to disk or output.
function Get-ManagedSigningPath {
    param([Parameter(Mandatory=$true)][string]$RepositoryPath)
    $normalized = [IO.Path]::GetFullPath($RepositoryPath).TrimEnd('\').ToUpperInvariant()
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $name = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($normalized))).Replace('-', '') }
    finally { $hash.Dispose() }
    return Join-Path $env:LOCALAPPDATA ("ChipmunksBuildTools/signing/$name.dat")
}

function Get-ManagedSigning {
    param([Parameter(Mandatory=$true)][string]$RepositoryPath, [switch]$MetadataOnly)
    $managedPath = Get-ManagedSigningPath $RepositoryPath
    if (-not [IO.File]::Exists($managedPath)) { return $null }
    $plain = $null; $keyBytes = $null; $certificates = $null; $certificate = $null; $work = $null
    try {
        if ((Get-Item -LiteralPath $managedPath).Length -gt 8MB) { throw 'Invalid managed signing size.' }
        Add-Type -AssemblyName System.Security
        $plain = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($managedPath), [Text.Encoding]::UTF8.GetBytes('Chipmunks.Build.Signing.v1'), [Security.Cryptography.DataProtectionScope]::CurrentUser)
        $profile = [Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json
        if ($profile.schemaVersion -ne 1 -or $profile.storeExtension -notin @('.p12', '.pfx')) { throw 'Invalid managed signing schema.' }
        foreach ($field in @('storeBase64', 'storePassword', 'keyAlias', 'keyPassword', 'certificateSha256')) {
            if ([string]::IsNullOrWhiteSpace([string]$profile.$field)) { throw 'Incomplete managed signing.' }
        }
        $keyBytes = [Convert]::FromBase64String($profile.storeBase64)
        if ($keyBytes.Length -eq 0 -or $keyBytes.Length -gt 4MB) { throw 'Invalid managed keystore.' }
        $certificates = [Security.Cryptography.X509Certificates.X509Certificate2Collection]::new()
        $certificates.Import($keyBytes, [string]$profile.storePassword, [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)
        foreach ($entry in $certificates) {
            if ($entry.HasPrivateKey) { if ($certificate) { throw 'Managed certificate has multiple private keys.' }; $certificate = $entry }
        }
        if (-not $certificate) { throw 'Managed certificate has no private key.' }
        $hash = [Security.Cryptography.SHA256]::Create()
        try { $fingerprint = [BitConverter]::ToString($hash.ComputeHash($certificate.RawData)).Replace('-', '') }
        finally { $hash.Dispose() }
        if ($fingerprint -ne ([string]$profile.certificateSha256).Replace(':','').Replace('-','')) { throw 'Managed certificate identity mismatch.' }
        $storeFile = $managedPath
        if (-not $MetadataOnly) {
            $taskId = $env:CHIPMUNKS_SIGNING_TASK_ID
            if (-not $taskId) { $taskId = [Guid]::NewGuid().ToString('N') }
            if ($taskId -notmatch '^[0-9a-f]{32}$') { throw 'Invalid signing task identity.' }
            $parent = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'ChipmunksBuildTools/signing'))
            if ((Get-Item -Force -LiteralPath $parent).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected signing directory.' }
            $work = Join-Path $parent ("work-$taskId")
            if (Test-Path -LiteralPath $work) { throw 'Signing workspace already exists.' }
            [IO.Directory]::CreateDirectory($work) | Out-Null
            $access = New-Object Security.AccessControl.DirectorySecurity
            $access.SetAccessRuleProtection($true, $false)
            $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
            $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
            $access.AddAccessRule($rule)
            Set-Acl -LiteralPath $work -AclObject $access
            [IO.File]::WriteAllText((Join-Path $work 'owned.marker'), 'chipmunks-signing-work-v1')
            $storeFile = Join-Path $work 'release.p12'
            [IO.File]::WriteAllBytes($storeFile, $keyBytes)
        }
        return [pscustomobject]@{
            Signing = [pscustomobject]@{ storeFile = $storeFile; storePassword = [string]$profile.storePassword; keyAlias = [string]$profile.keyAlias; keyPassword = [string]$profile.keyPassword }
            TemporaryDirectory = $work
            CertificateSha256 = $fingerprint
        }
    } catch {
        if ($work) { Remove-ManagedSigningWork $work }
        throw 'Managed signing could not be read or verified. Open signing management to restore your encrypted backup with this Windows account. The build has stopped without changing signing identity.'
    } finally {
        if ($certificates) { foreach ($entry in $certificates) { $entry.Reset() } }
        if ($plain) { [Array]::Clear($plain, 0, $plain.Length) }
        if ($keyBytes) { [Array]::Clear($keyBytes, 0, $keyBytes.Length) }
    }
}

function Remove-ManagedSigningWork {
    param([string]$Path)
    if (-not $Path) { return }
    $parent = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'ChipmunksBuildTools/signing')).TrimEnd('\')
    $resolved = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    if (-not $resolved.StartsWith($parent + '\', [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetDirectoryName($resolved) -ne $parent -or [IO.Path]::GetFileName($resolved) -notmatch '^work-[0-9a-f]{32}$') { return }
    if (-not (Test-Path -LiteralPath $resolved)) { return }
    if ((Get-Item -Force -LiteralPath $resolved).Attributes -band [IO.FileAttributes]::ReparsePoint) { return }
    $marker = Join-Path $resolved 'owned.marker'
    if (-not [IO.File]::Exists($marker) -or [IO.File]::ReadAllText($marker) -ne 'chipmunks-signing-work-v1') { return }
    try {
        foreach ($file in @('release.p12', 'owned.marker')) { $target = Join-Path $resolved $file; if ([IO.File]::Exists($target)) { [IO.File]::Delete($target) } }
        [IO.Directory]::Delete($resolved, $false)
    } catch { Write-Host '[WARNING] This task signing workspace could not be fully removed; it is restricted to the current Windows user.' }
}
