<#
  Harnais de bout en bout des parcours du chat MimmozIA (site mimmoza-front-v2).
  Rejoue des conversations completes (extension, photo + instructions, plan lu, variantes, maison neuve, photo de
  telephone, plans) avec les vrais outils du chat, un modele de langage simule et un reseau fige. Aucun appel reseau,
  aucune base reelle, aucun cout.

  Utilisation (depuis n'importe quel dossier) :
    pwsh -File scripts\harnais\LANCER-HARNAIS.ps1            # tous les scenarios
    pwsh -File scripts\harnais\LANCER-HARNAIS.ps1 S2 S7      # seulement S2 et S7
  Rapport : affiche a l'ecran et ecrit dans %TEMP%\mimmoza-harnais-rapport.txt. Code de sortie 1 si une etape echoue.
#>
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Scenarios = @())
$ErrorActionPreference = 'Stop'
$Racine = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $Racine
$Rapport = Join-Path $env:TEMP 'mimmoza-harnais-rapport.txt'
$env:HARNAIS_RAPPORT = $Rapport
$Arguments = @('deno', 'run', '--no-lock', '--no-check', '--no-config', '-A', '--node-modules-dir=none', 'supabase/functions/copilot-chat/harnais/rapport.ts') + $Scenarios
& npx @Arguments
$Code = $LASTEXITCODE
Write-Host ''
Write-Host "Rapport ecrit dans : $Rapport"
exit $Code
