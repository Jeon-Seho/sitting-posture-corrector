param(
    [Parameter(Mandatory = $true)][string]$TargetExe,
    [Parameter(Mandatory = $true)][string]$IconPath
)
$ErrorActionPreference = 'Stop'
$resolvedExe = (Resolve-Path -LiteralPath $TargetExe).Path
$resolvedIcon = (Resolve-Path -LiteralPath $IconPath).Path
$desktopFolder = [Environment]::GetFolderPath('Desktop')
if (-not (Test-Path -LiteralPath $desktopFolder -PathType Container)) {
    throw 'Windows Desktop folder is unavailable.'
}
$shortcutPath = Join-Path $desktopFolder 'PoseGood.lnk'
$shortcutShell = New-Object -ComObject WScript.Shell
$shortcut = $shortcutShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $resolvedExe
$shortcut.WorkingDirectory = Split-Path -Parent $resolvedExe
$shortcut.IconLocation = "$resolvedIcon,0"
$shortcut.Description = 'PoseGood'
$shortcut.Save()
$verifiedShortcut = $shortcutShell.CreateShortcut($shortcutPath)
if ($verifiedShortcut.TargetPath -ne $resolvedExe) { throw 'Desktop shortcut target verification failed.' }
Write-Output "Desktop shortcut ready: $shortcutPath"
