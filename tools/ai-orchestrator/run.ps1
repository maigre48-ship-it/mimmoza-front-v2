param(
  [Parameter(Mandatory=$true)]
  [string]$Spec,
  [ValidateSet("anthropic","openai")]
  [string]$Engine = "anthropic"
)

$ErrorActionPreference = "Stop"

$gitRoot = git rev-parse --show-toplevel 2>$null
if (-not $gitRoot) { throw "Not inside a git repository." }
Set-Location $gitRoot

if (-not (Test-Path ".\tools\ai-orchestrator\run.mjs")) {
  throw "Missing tools/ai-orchestrator/run.mjs"
}

node ".\tools\ai-orchestrator\run.mjs" --spec $Spec --engine $Engine
