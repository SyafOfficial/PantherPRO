/** The downloadable launcher contains program/configuration only, never secrets. */
export function monitorLauncher(observer: string, mapping: string) {
  const encoded = (s: string) => Buffer.from(s, "utf8").toString("base64");
  return `param([switch]$Once)
$ErrorActionPreference = 'Stop'
$monitorFolder = 'C:\\Panther-Client-Monitor'
$monitorPython = Join-Path $monitorFolder 'venv\\Scripts\\python.exe'
$monitorTerminal = Join-Path $monitorFolder 'terminal64.exe'
if (!(Test-Path -LiteralPath $monitorPython) -or !(Test-Path -LiteralPath $monitorTerminal)) {
    throw 'The dedicated MT5 and Python environment must be installed first.'
}
[IO.File]::WriteAllBytes((Join-Path $monitorFolder 'vestrado_clients.py'), [Convert]::FromBase64String('${encoded(observer)}'))
[IO.File]::WriteAllBytes((Join-Path $monitorFolder 'vestrado-mapping.json'), [Convert]::FromBase64String('${encoded(mapping)}'))
$observerArgs = @((Join-Path $monitorFolder 'vestrado_clients.py'), '--terminal', $monitorTerminal, '--mapping', (Join-Path $monitorFolder 'vestrado-mapping.json'))
if ($Once) { $observerArgs += '--once' }
& $monitorPython @observerArgs
if ($LASTEXITCODE -ne 0) { throw 'Observer stopped. Check the message above. Do not stop the price bridge.' }
`;
}
