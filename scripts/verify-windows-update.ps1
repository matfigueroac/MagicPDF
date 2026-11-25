param(
    [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+$')][string] $BaseVersion,
    [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+$')][string] $TargetVersion,
    [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string] $Publisher,
    [Parameter(Mandatory)][ValidatePattern('^[0-9A-Fa-f]{40}$')][string] $Thumbprint
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ([version]$TargetVersion -le [version]$BaseVersion) { throw 'La versión de destino debe ser superior.' }
$feed = 'http://10.0.2.100:3268'
$exeName = 'MagicPDF Pro.exe'
$exe = Join-Path $env:LOCALAPPDATA "Programs\MagicPDF Pro\$exeName"
$setupName = "MagicPDF-Pro-Setup-$BaseVersion.exe"
$pending = Join-Path $env:LOCALAPPDATA "magic-pdf-updater\pending\MagicPDF-Pro-Setup-$TargetVersion.exe"
$scratch = Join-Path $env:TEMP ("magicpdf-production-" + [guid]::NewGuid().ToString('N'))
$profile = Join-Path $env:APPDATA 'MagicPDF Pro'
$sentinel = Join-Path $profile ("update-probe-" + [guid]::NewGuid().ToString('N') + '.txt')

function Assert-ProductionSignature($File) {
    $signature = Get-AuthenticodeSignature -LiteralPath $File
    if ($signature.Status -ne 'Valid' -or $signature.SignatureType -ne 'Authenticode' -or
        $signature.SignerCertificate.Subject -cne $Publisher -or $signature.SignerCertificate.Thumbprint -ne $Thumbprint -or
        -not $signature.TimeStamperCertificate) {
        throw "Firma de producción inválida ($($signature.Status)): $File"
    }
    [pscustomobject]@{ File = $File; Publisher = $signature.SignerCertificate.Subject; Thumbprint = $Thumbprint; SHA256 = (Get-FileHash -LiteralPath $File).Hash }
}

function Get-InstalledVersion {
    if (Test-Path -LiteralPath $exe -PathType Leaf) {
        (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
    }
}

$machineExe = Join-Path $env:ProgramFiles "MagicPDF Pro\$exeName"
if ((Get-InstalledVersion) -or (Test-Path -LiteralPath $machineExe) -or (Get-AppxPackage -Name '*MagicPDF*')) {
    throw 'La prueba requiere una VM sin una instalación previa de MagicPDF.'
}

$null = New-Item -ItemType Directory -Path $scratch
$setup = Join-Path $scratch $setupName
try {
    Invoke-WebRequest -Uri "$feed/$setupName" -OutFile $setup -UseBasicParsing -TimeoutSec 360
    Assert-ProductionSignature $setup
    $install = Start-Process -FilePath $setup -ArgumentList '/S', '/currentuser' -Wait -PassThru
    if ($install.ExitCode -ne 0 -or (Get-InstalledVersion) -notin $BaseVersion, "$BaseVersion.0") {
        throw "Instalación inicial incorrecta. Código $($install.ExitCode). Versión $(Get-InstalledVersion)."
    }
    Assert-ProductionSignature $exe
    $null = New-Item -ItemType Directory -Path $profile -Force
    $probe = [guid]::NewGuid().ToString()
    Set-Content -LiteralPath $sentinel -Value $probe
    Start-Process -FilePath $exe
    Write-Host 'En MagicPDF, descarga la versión nueva desde Inicio → Buscar actualizaciones. Espera la confirmación de este script antes de cerrar.'

    $deadline = (Get-Date).AddMinutes(30)
    while (-not (Test-Path -LiteralPath $pending -PathType Leaf)) {
        if ((Get-Date) -gt $deadline) { throw 'El actualizador no descargó el instalador esperado.' }
        Start-Sleep -Seconds 2
    }
    Assert-ProductionSignature $pending
    Write-Host 'La firma de la descarga es válida. Cierra MagicPDF para aplicar la actualización.'
    $deadline = (Get-Date).AddMinutes(20)
    while ((Get-InstalledVersion) -notin $TargetVersion, "$TargetVersion.0") {
        if ((Get-Date) -gt $deadline) { throw 'La versión esperada no quedó instalada.' }
        Start-Sleep -Seconds 2
    }
    Assert-ProductionSignature $exe
    if ((Get-Content -LiteralPath $sentinel -Raw).Trim() -ne $probe) { throw 'Los datos de prueba cambiaron al actualizar.' }
    Write-Host "Actualización $BaseVersion → $TargetVersion verificada. Los datos de prueba se conservaron."
} finally {
    foreach ($file in $setup, $sentinel) {
        if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file }
    }
    Remove-Item -LiteralPath $scratch
}
