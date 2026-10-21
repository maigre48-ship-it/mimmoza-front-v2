# =============================================================================
# Déploiement des correctifs de facturation et de troncature — 2026-09-08
# -----------------------------------------------------------------------------
# À lancer depuis la racine du dépôt :
#     cd C:\Users\maigr\Dev\mimmoza-front-v2
#     .\deploy-facturation.ps1
#
# Options :
#     .\deploy-facturation.ps1 -Verifier      # ne déploie rien, contrôle seulement
#     .\deploy-facturation.ps1 -SansFront     # Edge Functions uniquement
# =============================================================================

param(
    [switch]$Verifier,
    [switch]$SansFront
)

$ErrorActionPreference = "Stop"
$ProjectRef = "fwvrqngbafqdaekbdfnm"

# Les 8 fonctions modifiées. `_shared/billing/featureBilling.ts` n'est PAS
# déployable seul : la CLI l'embarque dans le bundle de chaque fonction qui
# l'importe. C'est pourquoi les cinq fonctions facturées doivent partir
# ensemble — en redéployer une seule laisserait les autres sur l'ancien module.
$Fonctions = @(
    "copilot-chat",              # troncature, facturation au réel, mode dans le flux
    "analyze-rehab-plan",        # + auth + 3 jetons
    "transcribe-rehab-plan",     # + auth + 5 jetons
    "export-report-v1",          # + auth + 10 jetons
    "facade-ai-render",          # + solde + 10/20/40 jetons
    "rendu-travaux-v1",          # + auth + 15 jetons
    "stream-estate-ingest-v1",   # + garde interne / auth + 30 jetons
    "plu-universal-parser"       # entrée tronquée + max_tokens
)

function Titre($texte) {
    Write-Host ""
    Write-Host "=== $texte ===" -ForegroundColor Cyan
}

# ── 0. Contrôles préalables ─────────────────────────────────────────────────
Titre "Contrôles préalables"

if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
    Write-Host "La CLI Supabase est introuvable." -ForegroundColor Red
    Write-Host "Installation : npm install -g supabase   (ou  scoop install supabase)"
    exit 1
}
Write-Host "CLI Supabase : $(supabase --version)" -ForegroundColor Green

if (-not (Test-Path ".\supabase\config.toml")) {
    Write-Host "Lancez ce script depuis la racine du depot (supabase\config.toml introuvable)." -ForegroundColor Red
    exit 1
}

foreach ($f in $Fonctions) {
    if (-not (Test-Path ".\supabase\functions\$f\index.ts")) {
        Write-Host "Fonction manquante : $f" -ForegroundColor Red
        exit 1
    }
}
if (-not (Test-Path ".\supabase\functions\_shared\billing\featureBilling.ts")) {
    Write-Host "Module de facturation partage introuvable." -ForegroundColor Red
    exit 1
}
Write-Host "Les 8 fonctions et le module partage sont presents." -ForegroundColor Green

if ($Verifier) {
    Titre "Mode verification : rien n'a ete deploye"
    exit 0
}

# ── 1. Migrations : DÉJÀ APPLIQUÉES ─────────────────────────────────────────
Titre "Migrations"
Write-Host @"
Les 5 migrations de facturation ont deja ete appliquees directement en base :
    20260908142258  facturation_reelle_copilot
    20260908175847  facturation_serveur_fonctionnalites
    20260908181438  verrouiller_rpc_facturation_public
    20260908183847  exemption_admin_spend_credits
    20260908184432  durcir_garde_service_role

NE LANCEZ PAS 'supabase db push' : les fichiers locaux de supabase\migrations
portent des noms differents de ceux enregistres dans l'historique distant, la
CLI tenterait donc de les rejouer. Les fonctions sont en CREATE OR REPLACE, donc
sans casse — mais l'historique deviendrait incoherent.

Les fichiers .sql du depot servent de reference et de reconstruction ; ils
seront alignes au prochain 'supabase migration repair' si vous le souhaitez.
"@ -ForegroundColor Yellow

# ── 2. Edge Functions ───────────────────────────────────────────────────────
Titre "Deploiement des Edge Functions"

$Echecs = @()
foreach ($f in $Fonctions) {
    Write-Host ""
    Write-Host "-> $f" -ForegroundColor White
    supabase functions deploy $f --project-ref $ProjectRef
    if ($LASTEXITCODE -ne 0) {
        Write-Host "   ECHEC" -ForegroundColor Red
        $Echecs += $f
    } else {
        Write-Host "   OK" -ForegroundColor Green
    }
}

if ($Echecs.Count -gt 0) {
    Write-Host ""
    Write-Host "Fonctions en echec : $($Echecs -join ', ')" -ForegroundColor Red
    Write-Host "Corrigez puis relancez. Le front n'a pas ete construit." -ForegroundColor Red
    exit 1
}

# ── 3. Front ────────────────────────────────────────────────────────────────
if (-not $SansFront) {
    Titre "Construction du front"

    # Volontairement PAS de 'npm run lint' bloquant.
    #
    # Le depot porte ~2720 erreurs ESLint pre-existantes (no-explicit-any,
    # no-unused-vars, set-state-in-effect) reparties sur tout le code : le lint
    # n'y passe pas et n'y est jamais passe. En faire une condition de
    # deploiement bloquerait sur une dette qui n'a rien a voir avec le
    # changement en cours.
    #
    # Le vrai garde-fou est 'npm run build' : 'tsc -b' echoue sur une erreur de
    # type ou un import casse, c'est-a-dire sur ce qui empeche reellement de
    # deployer. Pour verifier la dette lint introduite par VOS modifications,
    # utilisez le bloc de comparaison affiche en fin de script.
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build en echec — c'est bloquant." -ForegroundColor Red
        exit 1
    }
    Write-Host "Build OK — poussez sur main pour que Vercel deploie." -ForegroundColor Green
}

# ── 4. Ce qu'il reste a faire a la main ─────────────────────────────────────
Titre "A verifier apres deploiement"
Write-Host @"
1. SECRET A RELEVER — ANTHROPIC_MAX_TOKENS
   Il bride actuellement les sorties vers ~4000 tokens et coupe les reponses.
   Le code demande 8000 (quick) a 16000 (report), plafonne a 16000.
       supabase secrets set ANTHROPIC_MAX_TOKENS=16000 --project-ref $ProjectRef
   Aucun impact economique : le debit est calcule sur l'usage reel.

2. SECRET OPTIONNEL — echeance globale du copilot
   Defaut 120000 ms, a ajuster au wall clock de votre plan Supabase.
       supabase secrets set COPILOT_DEADLINE_MS=120000 --project-ref $ProjectRef

3. TEST DE BOUT EN BOUT — le chemin de debit serveur n'a JAMAIS tourne.
   Avec un compte NON-ADMIN (un admin est exempte, le test ne prouverait rien) :
     a. lancer un rafraichissement de veille     -> 30 jetons
     b. generer un rendu travaux                 -> 15 jetons
     c. analyser un plan de rehabilitation       -> 3 jetons
   Puis controler en base :
       select type, amount, description, created_at
       from credit_transactions
       where created_at > now() - interval '1 hour'
       order by created_at desc;
   Si vous voyez des erreurs 500 BILLING_UNAVAILABLE, c'est la resolution de la
   cle service_role : verifiez SUPABASE_SECRET_KEYS.

4. SECRETS A FAIRE TOURNER
   .env.local contient OPENAI_API_KEY et ANTHROPIC_API_KEY dans un projet Vite.
   Verifiez qu'elles ne sont jamais parties dans un build, et regenerez-les.
"@ -ForegroundColor Yellow

Titre "Verifier la dette lint introduite par vos modifications"
Write-Host @"
Le depot porte ~2720 erreurs ESLint pre-existantes : un 'npm run lint' global ne
dit rien d'utile. Pour savoir si VOS changements en ajoutent, comparez le meme
jeu de fichiers avant et apres :

    `$f = git diff --name-only HEAD -- '*.ts' '*.tsx'
    npx eslint `$f -f compact 2>`$null | Select-String ' error ' | Measure-Object | % Count
    git stash push -- `$f
    npx eslint `$f -f compact 2>`$null | Select-String ' error ' | Measure-Object | % Count
    git stash pop

Si les deux nombres sont egaux, vos modifications n'ont rien ajoute.
Attention : 'git stash pop' est indispensable, sinon vos changements restent
remises.
"@ -ForegroundColor Cyan

Write-Host ""
Write-Host "Termine." -ForegroundColor Green
