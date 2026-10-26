param([switch]$Deploy)
$ErrorActionPreference = 'Stop'
$projectRoot = (Get-Item -LiteralPath "$PSScriptRoot\..\..\..").FullName
$arguments = @("$projectRoot\deploy\deploy_cloud_run.py")
if ($Deploy) { $arguments += '--deploy' }
& python @arguments
exit $LASTEXITCODE
