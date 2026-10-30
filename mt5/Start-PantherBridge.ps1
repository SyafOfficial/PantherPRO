# Read-only local MT5 snapshot uploader. No broker login or trading functions.
param(
 [string]$Endpoint='https://pantherpro.onrender.com/api/bridge/mt5',
 [string]$SnapshotPath=(Join-Path $env:APPDATA 'MetaQuotes\Terminal\Common\Files\PantherFX\vestrado-snapshot.json')
)
$ErrorActionPreference='Stop'
$uri=[Uri]$Endpoint
if($uri.Scheme -ne 'https' -or $uri.Host -ne 'pantherpro.onrender.com' -or $uri.AbsolutePath -ne '/api/bridge/mt5' -or $uri.Query -or $uri.Fragment -or $uri.UserInfo){throw 'Endpoint must be the PantherPRO HTTPS bridge endpoint.'}
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$secure=Read-Host 'Paste MT5_BRIDGE_SECRET (input hidden)' -AsSecureString
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{$secret=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
if($secret.Length -lt 32){throw 'Bridge secret must contain at least 32 characters.'}
$utf8=New-Object Text.UTF8Encoding($false)
$lastDigest=''
Write-Host 'Panther read-only uploader started. Keep MT5 and this window running. Ctrl+C stops it.'
try{
 while($true){
  try{
   if(-not(Test-Path -LiteralPath $SnapshotPath)){throw 'Snapshot missing; check the MT5 exporter.'}
   if((Get-Item -LiteralPath $SnapshotPath).Length -gt 2097152){throw 'Snapshot exceeds 2 MiB.'}
   $body=[IO.File]::ReadAllText($SnapshotPath,$utf8)
   $parsed=$body | ConvertFrom-Json
   if($parsed.symbol -ne 'XAUUSD.V' -or $parsed.execution_enabled -ne $false){throw 'Unexpected snapshot.'}
   $exported=[DateTime]::ParseExact($parsed.exported_at_utc,'yyyy.MM.dd HH:mm:ss',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal)
   $age=([DateTime]::UtcNow-$exported).TotalSeconds
   if($age -lt 0 -or $age -gt 30){throw 'Snapshot is stale. Keep MT5 running and PC clock correct.'}
   $bytes=$utf8.GetBytes($body)
   $sha=[Security.Cryptography.SHA256]::Create()
   try{$digest=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
   if($digest -ne $lastDigest){
    $timestamp=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString([Globalization.CultureInfo]::InvariantCulture)
    $hmac=New-Object Security.Cryptography.HMACSHA256
    try{$hmac.Key=$utf8.GetBytes($secret);$signature=([BitConverter]::ToString($hmac.ComputeHash($utf8.GetBytes($timestamp+'.'+$digest)))).Replace('-','').ToLowerInvariant()}finally{$hmac.Dispose()}
    $result=Invoke-RestMethod -Uri $Endpoint -Method Post -ContentType 'application/json; charset=utf-8' -Body $bytes -Headers @{'x-panther-timestamp'=$timestamp;'x-panther-signature'=$signature} -MaximumRedirection 0 -TimeoutSec 25
    if($result.received -eq $true){$lastDigest=$digest;Write-Host ('Snapshot accepted at '+[DateTime]::Now.ToString('HH:mm:ss')+'; this acknowledgment does not mean a signal was published.')}
   }
  }catch{
   # Do not print exception bodies/headers, raw snapshots, signatures or credentials.
   $status=$null
   if($_.Exception.Response){$status=[int]$_.Exception.Response.StatusCode}
   if($status){Write-Warning ('Upload not accepted; HTTP '+$status+'. Check enabled bridge, matching secret and server migrations.')}else{Write-Warning 'Snapshot unavailable/stale or connection failed. Check MT5, PC clock and connection.'}
  }
  Start-Sleep -Seconds 10
 }
}finally{$secret=$null;$secure.Dispose()}
