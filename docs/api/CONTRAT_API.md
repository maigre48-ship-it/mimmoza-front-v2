# Contrat commun — refonte API Mimmoza (22/10/2026)

Dépôt : `C:\Users\maigr\Dev\mimmoza-front-v2` (dans le shell de l'appareil : `~/mnt/Dev/mimmoza-front-v2`), branche `correctifs-audit-20261021`.
Supabase prod : `fwvrqngbafqdaekbdfnm`.

## Principe absolu : ne jamais perdre d'argent
- Aucun crédit « à crédit » : pas de dépassement facturé après coup. Quota épuisé = refus 402 (`credits_epuises`), sauf crédits de recharge PRÉPAYÉS.
- Le quota est porté par le COMPTE (utilisateur), pas par la clé : créer 5 clés ne multiplie plus les crédits.
- Débit ATOMIQUE avant l'appel (réservation, verrou de ligne), remboursement si l'appel échoue (statut ≥ 400 ou exception). Aucune course possible qui dépasse le solde.
- Seul le serveur (service_role / admin) change un plan ou un solde. L'utilisateur ne peut rien modifier de financier.
- Chaque endpoint coûte ≥ 1 crédit. Le prix le plus bas vendu est 1,60 € / 1 000 crédits (Scale annuel) = 0,0016 €/crédit : le coût d'un endpoint doit couvrir au moins 3× son coût réel (appels LLM, services payants).

## Formules (€ HT)
| id | Prix mensuel | Prix/mois en annuel | Crédits/mois | Recharge prépayée (€/1 000) | Req/min | Clés max |
|---|---|---|---|---|---|---|
| essai | 0 | — | 500 crédits UNE SEULE FOIS, valables 30 jours | — (pas de recharge) | 10 | 2 |
| starter | 49 | 39 | 10 000 | 5,90 | 60 | 5 |
| growth | 149 | 119 | 50 000 | 3,50 | 200 | 20 |
| scale | 499 | 400 | 250 000 | 2,40 | 1 000 | 100 |

- Ordre de consommation : crédits du mois → crédits de recharge (valables 12 mois).
- Crédits du mois non reportés ; remise à zéro le 1er du mois (cron existant `api-keys-remise-a-zero-mensuelle` à faire évoluer ou remplacer).
- Plus de « pay as you go » postpayé : remplacé par des packs de recharge prépayés réservés aux abonnés (prix = colonne Recharge).
- Tant que Stripe n'existe pas : activation d'une formule / d'une recharge par l'admin (fonction admin), demande par e-mail (`mailtoDemandeAcces` de `src/lib/billing/grille.ts`).
- Tout nouveau compte API démarre en `essai`. Les 7 clés existantes (aujourd'hui « starter » 10 000 gratuits) passent en `essai`.

## Catalogue des endpoints (crédits)
| Méthode + chemin | Fonction(s) interne(s) | Crédits | Statut |
|---|---|---|---|
| GET /health | — | 0 | live |
| POST /v1/scoring/smart | smartscore-enriched-v3 | 10 | live |
| POST /v1/market/dvf | smartscore-enriched-v3 (include dvf) — STATISTIQUES uniquement, aucune adresse / id de mutation / date exacte de vente individuelle | 3 | live |
| POST /v1/risks | smartscore-enriched-v3 (include risques) | 3 | live |
| POST /v1/parcelle | cadastre-parcelle-by-id / foncier-lookup-v1 | 1 | live |
| POST /v1/plu | plu-from-parcelle-v2 (+ plu-rules-by-zone-v1) | 4 | live |
| POST /v1/servitudes | servitudes-gpu-v1 | 2 | live |
| POST /v1/faisabilite | plu-faisabilite-summary-v1 / etude-parcelle-v1 | 25 | live |
| POST /v1/permis | sitadel-v1 | 2 | live |
| POST /v1/dpe | dpe-ademe-v1 | 1 | live |
| POST /v1/batiment | batiment-bdnb-v1 | 2 | live |
| POST /v1/loyers | loyers-reference-v1 | 1 | live |
| POST /v1/fiscalite | taxes-locales-v1 + zonage-abc-v1 | 2 | live |
| POST /v1/environnement | bruit-classement-v1 + potentiel-solaire-v1 + altimetrie-v1 + patrimoine-merimee-v1 | 3 | live |
| POST /v1/mobilite | transport-score-gtfs-v1 | 2 | live |
| POST /v1/couts | couts-construction-v1 / couts-renovation-v1 | 2 | beta |
| POST /v1/estimation | valuation-engine | 15 | beta |

(`export-report-v1` utilise Anthropic et dépend du contexte de conversation : NON exposé.)
L'agent passerelle peut ajuster un coût À LA HAUSSE s'il découvre un coût réel (LLM, API payante) ; jamais à la baisse. Il le signale dans son rapport ; le catalogue front doit alors suivre.

## Interface base de données (agent BDD fournit, agent passerelle consomme)
Tout en `security definer`, `set search_path = public, pg_temp`, EXECUTE révoqué à public/anon/authenticated sauf mention.

- `public.api_reserver_credits(p_key_id uuid, p_endpoint text, p_cout integer) returns jsonb` — service_role.
  Vérifie : clé existe, non révoquée ; compte du propriétaire ; essai non expiré ; débit/minute (`rate_limit_min`) ; solde (mois puis recharge). Débite atomiquement (SELECT … FOR UPDATE).
  Retour : `{"ok":true,"source_mois":n,"source_recharge":m,"restant":r,"limite":l,"plan":"starter"}` ou `{"ok":false,"raison":"cle_invalide"|"essai_expire"|"debit_depasse"|"credits_epuises","restant":r,"limite":l,"reessayer_dans":s?}`.
  Incrémente aussi `api_keys.requests_count` (statistique par clé) et `last_used_at`.
- `public.api_rembourser_credits(p_key_id uuid, p_source_mois integer, p_source_recharge integer) returns void` — service_role. Rend exactement ce qui a été débité.
- `public.increment_api_usage(...)` existant : conservé pour le journal ; la passerelle l'appelle avec `p_cost = 0` (le compteur financier est géré par la réservation).
- `public.api_mon_compte() returns jsonb` — authenticated (son propre compte, auth.uid()) : plan, credits_mois, credits_utilises, credits_recharge, recharge_expire_le, essai_expire_le, periode_debut, rate_limit_min, max_cles, cles_actives.
- `public.admin_api_definir_formule(p_user_id uuid, p_plan text, p_ajout_recharge integer default 0) returns jsonb` — authenticated mais gardé par `public._garde_admin_uniquement()` (existe déjà).
- Le nombre de clés actives par compte est plafonné (`max_cles`) à la création (déclencheur).
- Déclencheur `api_keys_proteger_quotas` existant (appliqué) : à conserver/adapter.

## Règles de travail (tous les agents)
- Fichiers majoritairement en CRLF : éditer en Python avec `newline=''`, préserver les fins de ligne. Jamais de suppression de fichier (interdit sur l'appareil).
- Le shell de l'appareil coupe à ~170 s par commande.
- NE PAS faire de `git commit` / `git add` (le coordinateur commitera) ; NE PAS pousser ; NE PAS appliquer de migration en production ; NE PAS déployer de fonction.
- Vérif TypeScript front : `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json` ; tests : `npm test` (node:test, 341 passent aujourd'hui).
- Ne jamais inventer de chiffres, témoignages, garanties (pas de SLA, pas de webhooks tant qu'ils n'existent pas).
- Rapport final : liste des fichiers créés/modifiés, ce qui est testé, ce qui ne l'est pas, écarts au contrat.
