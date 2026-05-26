# test-copilot.ps1
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$SUPABASE_URL = "https://fwvrqngbafqdaekbdfnm.supabase.co"
$JWT = "eyJhbGciOiJIUzI1NiIsImtpZCI6IjFsSGdsYVlObXJWMlZEYlYiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL2Z3dnJxbmdiYWZxZGFla2JkZm5tLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiIzNzViZWI2NS02ZTZhLTQ5MjItYWU3MC03N2NkNzRlOGFkN2QiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzc5MzQ4MjQ4LCJpYXQiOjE3NzkzNDQ2NDgsImVtYWlsIjoibWFpZ3JlNDhAZ21haWwuY29tIiwicGhvbmUiOiIiLCJhcHBfbWV0YWRhdGEiOnsicHJvdmlkZXIiOiJlbWFpbCIsInByb3ZpZGVycyI6WyJlbWFpbCJdfSwidXNlcl9tZXRhZGF0YSI6eyJlbWFpbF92ZXJpZmllZCI6dHJ1ZX0sInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiYWFsIjoiYWFsMSIsImFtciI6W3sibWV0aG9kIjoicGFzc3dvcmQiLCJ0aW1lc3RhbXAiOjE3NzkzNDQ2NDh9XSwic2Vzc2lvbl9pZCI6ImM4ZWE5ZjIwLTEzNGMtNDRmYy1iMTI5LTlmNWNmNjMwMTNiMiIsImlzX2Fub255bW91cyI6ZmFsc2V9.zaaDS_Nu3J0zCFipgXE1NL-QaZxHXi4Kiyrp0p-qgso"

$body = @{
  message = "Calcule le SmartScore de cette parcelle et donne-moi les comparables de prix du marché local."
  mode    = "advanced"
  context = @{
    vertical = "investisseur"
    route    = "/investisseur/parcelle/test"
    parcel   = @{
      id         = "test-1"
      commune    = "Bordeaux"
      code_insee = "33063"
      lat        = 44.8378
      lng        = -0.5792
    }
  }
} | ConvertTo-Json -Depth 6

Write-Host "Envoi de la requête..." -ForegroundColor Cyan

$req = [System.Net.HttpWebRequest]::Create("$SUPABASE_URL/functions/v1/copilot-chat")
$req.Method = "POST"
$req.ContentType = "application/json"
$req.Headers.Add("Authorization", "Bearer $JWT")
$req.AllowReadStreamBuffering = $false
$req.Timeout = 120000
$req.ReadWriteTimeout = 120000

$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
$reqStream = $req.GetRequestStream()
$reqStream.Write($bytes, 0, $bytes.Length)
$reqStream.Close()

try {
  $resp = $req.GetResponse()
} catch [System.Net.WebException] {
  $errResp = $_.Exception.Response
  if ($errResp) {
    $er = New-Object System.IO.StreamReader($errResp.GetResponseStream())
    Write-Host "[ERREUR HTTP] $($errResp.StatusCode)" -ForegroundColor Red
    Write-Host ($er.ReadToEnd()) -ForegroundColor Red
  } else {
    Write-Host "[ERREUR] $($_.Exception.Message)" -ForegroundColor Red
  }
  exit
}

$reader = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)

Write-Host "`n--- STREAM ---`n" -ForegroundColor Cyan
$toolsSeen = @()

while (-not $reader.EndOfStream) {
  $line = $reader.ReadLine()
  if ($line -and $line.StartsWith("data:")) {
    $json = $line.Substring(5).Trim()
    if ($json) {
      try { $evt = $json | ConvertFrom-Json } catch { continue }
      switch ($evt.type) {
        "reservation"    { Write-Host "[crédits] réservé $($evt.reserved_credits), reste $($evt.remaining)" -ForegroundColor Yellow }
        "conversation"   { Write-Host "[conv] $($evt.conversation_id)" -ForegroundColor DarkGray }
        "token"          { Write-Host -NoNewline $evt.delta }
        "tool_use_start" { Write-Host "`n[outil →] $($evt.call.name) $($evt.call.input | ConvertTo-Json -Compress)" -ForegroundColor Magenta }
        "tool_use_end"   {
          $toolsSeen += $evt.call.name
          $c = if ($evt.call.status -eq "success") { "Green" } else { "Red" }
          Write-Host "[outil ✓] $($evt.call.name) → $($evt.call.status) ($($evt.call.duration_ms)ms)" -ForegroundColor $c
          if ($evt.call.error) { Write-Host "          $($evt.call.error)" -ForegroundColor Red }
        }
        "done"           { Write-Host "`n`n[terminé] coût=$($evt.final_credits)" -ForegroundColor Green }
        "error"          { Write-Host "`n[ERREUR] $($evt.error) (remboursé: $($evt.refunded_credits))" -ForegroundColor Red }
      }
    }
  }
}
$reader.Close()
$resp.Close()

Write-Host "`n--- RÉCAP TOOLS ---" -ForegroundColor Cyan
if ($toolsSeen.Count -eq 0) { Write-Host "Aucun tool appelé." -ForegroundColor Yellow }
else { $toolsSeen | Group-Object | ForEach-Object { Write-Host "  $($_.Name) x$($_.Count)" } }

