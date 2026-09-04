# scripts/import-proprietaires-restants.ps1
#
# Importe les departements manquants des proprietaires personnes morales, par
# tranches successives.
#
# ─── Pourquoi des tranches plutot qu'un seul « --departements tous » ─────────
# Un import national d'un seul tenant represente plusieurs heures. Une coupure
# a la sixieme heure obligerait a tout reprendre : l'upsert est idempotent, donc
# rien ne serait corrompu, mais rien ne serait gagne non plus. Decoupe en sept,
# un echec ne coute que sa tranche — et le script continue avec les suivantes
# plutot que de s'arreter.
#
# Chaque tranche tient dans UNE SEULE des deux archives du producteur
# (01 a 56, puis 57 a 976). Le script Node saute celle qui ne peut contenir
# aucun departement demande, ce qui evite de retelecharger plusieurs centaines
# de Mo pour rien.
#
# ─── Avant de lancer ────────────────────────────────────────────────────────
#   $env:SUPABASE_URL="https://fwvrqngbafqdaekbdfnm.supabase.co"
#   $env:SUPABASE_SERVICE_ROLE_KEY="<cle service_role>"
#   .\scripts\import-proprietaires-restants.ps1
#
# La cle service_role ouvre toute la base : elle vit dans la session, jamais
# dans un fichier versionne.
#
# Options :
#   -DryRun      analyse seule, aucune ecriture — pour verifier la mecanique
#   -Depuis <n>  reprend a la tranche n (1 a 7), si une seule a echoue

param(
    [switch] $DryRun,
    [int]    $Depuis = 1
)

$ErrorActionPreference = "Stop"

# ── Verifications prealables ────────────────────────────────────────────────

if (-not $env:SUPABASE_URL -or -not $env:SUPABASE_SERVICE_ROLE_KEY) {
    Write-Host "Variables manquantes." -ForegroundColor Red
    Write-Host ''
    Write-Host '  $env:SUPABASE_URL="https://fwvrqngbafqdaekbdfnm.supabase.co"'
    Write-Host '  $env:SUPABASE_SERVICE_ROLE_KEY="<cle>"'
    exit 1
}

$racine = Split-Path -Parent $PSScriptRoot
$script = Join-Path $racine "scripts\import-proprietaires-personnes-morales.mjs"

if (-not (Test-Path $script)) {
    Write-Host "Script introuvable : $script" -ForegroundColor Red
    exit 1
}

# ── Les tranches ────────────────────────────────────────────────────────────
#
# Equilibrees a la louche par volume, pas par nombre : les tranches contenant
# des departements denses (13, 33, 59, 75, 92, 93) en comptent moins.
# Les departements 01 a 19 et 69 sont deja en base et n'y figurent pas.

$tranches = @(
    @{ N = 1; Archive = "01-56";  Depts = "2A,2B,21,22,23,24,25,26,27,28,29,30" },
    @{ N = 2; Archive = "01-56";  Depts = "31,32,33,34,35,36,37,38,39,40,41,42,43" },
    @{ N = 3; Archive = "01-56";  Depts = "44,45,46,47,48,49,50,51,52,53,54,55,56" },
    @{ N = 4; Archive = "57-976"; Depts = "57,58,59,60,61,62,63,64,65,66,67,68" },
    @{ N = 5; Archive = "57-976"; Depts = "70,71,72,73,74,75,76,77,78" },
    @{ N = 6; Archive = "57-976"; Depts = "79,80,81,82,83,84,85,86,87,88,89,90" },
    @{ N = 7; Archive = "57-976"; Depts = "91,92,93,94,95,971,972,973,974,976" }
)

# ── Execution ───────────────────────────────────────────────────────────────

$debutTotal = Get-Date
$reussies = @()
$echouees = @()

Write-Host ""
Write-Host "Import des proprietaires personnes morales — departements restants" -ForegroundColor Cyan
if ($DryRun) { Write-Host "Mode analyse seule, aucune ecriture" -ForegroundColor Yellow }
Write-Host ("Tranches {0} a 7" -f $Depuis)
Write-Host ""

foreach ($t in $tranches) {
    if ($t.N -lt $Depuis) { continue }

    $nb = ($t.Depts -split ',').Count
    Write-Host ("─" * 70)
    Write-Host ("Tranche {0}/7 — archive {1} — {2} departements" -f $t.N, $t.Archive, $nb) -ForegroundColor Cyan
    Write-Host $t.Depts -ForegroundColor DarkGray
    Write-Host ""

    $debut = Get-Date
    $args = @($script, "--departements", $t.Depts)
    if ($DryRun) { $args += "--dry-run" }

    # On ne veut PAS qu'une tranche en echec arrete tout : le but du decoupage
    # est justement de limiter la casse. D'ou le ErrorActionPreference local.
    $ancien = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & node @args
    $code = $LASTEXITCODE
    $ErrorActionPreference = $ancien

    $duree = (Get-Date) - $debut

    if ($code -eq 0) {
        $reussies += $t.N
        Write-Host ("`nTranche {0} terminee en {1:hh\:mm\:ss}" -f $t.N, $duree) -ForegroundColor Green
    } else {
        $echouees += $t.N
        Write-Host ("`nTranche {0} EN ECHEC (code {1}) apres {2:hh\:mm\:ss}" -f $t.N, $code, $duree) -ForegroundColor Red
        Write-Host "On continue avec la suivante." -ForegroundColor DarkGray
    }
    Write-Host ""
}

# ── Bilan ───────────────────────────────────────────────────────────────────

$dureeTotale = (Get-Date) - $debutTotal

Write-Host ("═" * 70)
Write-Host ("Duree totale : {0:hh\:mm\:ss}" -f $dureeTotale)
Write-Host ("Tranches reussies : {0}" -f $(if ($reussies) { $reussies -join ', ' } else { 'aucune' })) -ForegroundColor Green

if ($echouees.Count -gt 0) {
    Write-Host ("Tranches en echec : {0}" -f ($echouees -join ', ')) -ForegroundColor Red
    Write-Host ""
    Write-Host "Pour rejouer une tranche seule, sans refaire les precedentes :" -ForegroundColor Yellow
    Write-Host ("  .\scripts\import-proprietaires-restants.ps1 -Depuis {0}" -f $echouees[0])
    Write-Host ""
    Write-Host "L'upsert est idempotent : relancer une tranche deja passee ne cree aucun doublon."
    exit 1
}

Write-Host ""
Write-Host "Tous les departements restants sont importes." -ForegroundColor Green
Write-Host "Verifie la couverture dans Admin > Fraicheur des donnees."
