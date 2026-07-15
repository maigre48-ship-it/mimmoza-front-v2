# RAPPORT PHASE 1 — Module « Agent commercial » (lecture seule)

> **Constat structurant à lire en premier.** Ce dépôt est un **front + un sous-ensemble d'Edge Functions**. Le schéma de base de données n'est **pas** dans le repo : les 4 fichiers `.sql` de `supabase/migrations/` sont **vides (0 octet)**, plusieurs dossiers de fonctions sont **vides** (`api-gateway`, `valuation-engine`, `synthesis-promoteur-v1`, `cadastre-from-commune`, `_shared`), et de nombreuses fonctions appelées par le front (`copilot-chat`, `opportunity-watch-run`, …) **n'existent que dans le projet Supabase déployé**. Toute la vérité « données + IA runtime » vit côté Supabase (dashboard), pas dans Git. Ce point conditionne presque toutes les décisions ci-dessous.

---

## A. Cartographie de l'existant

### 1. Routes

- **Librairie** : `react-router-dom` `^7.12.0`, API par éléments `<Routes>/<Route>` (pas de `createBrowserRouter`). Montage dans `src/main.tsx` via `<BrowserRouter>`.
- **Fichier unique de routes** : `src/App.tsx` (472 lignes, un seul bloc `<Routes>` ligne 233). Aucun fichier de config de routeur séparé.
- **Bloc admin** — `src/App.tsx:300-320` :

```tsx
<Route path="/admin/login" element={<AdminLoginPage />} />
<Route path="/admin" element={<AdminGuard><AdminLayout /></AdminGuard>}>
  <Route index                element={<AdminDashboardPage />} />
  <Route path="utilisateurs"  element={<AdminUtilisateursPage />} />
  <Route path="abonnements"   element={<AdminAbonnementsPage />} />
  <Route path="jetons"        element={<AdminJetonsPage />} />
  <Route path="copilot"       element={<AdminCopilotPage />} />
  <Route path="devis"         element={<AdminDevisPage />} />
  <Route path="factures"      element={<AdminFacturesPage />} />
  <Route path="entreprises"   element={<AdminEntreprisesPage />} />
  <Route path="tarifs"        element={<AdminTarifsPage />} />
  <Route path="parametres"    element={<AdminParametresPage />} />
</Route>
```

- **Conventions** : un segment de tête par « espace » (`/admin`, `/promoteur`, `/marchand-de-bien`, `/apporteur`…). Sous-sections admin en français, minuscules, un mot, **chemins enfants relatifs** (sans `/`). Le parent est protégé par `<AdminGuard>` et rend `<AdminLayout>` + `<Outlet/>`.
- **Où ajouter `/admin/agent-commercial`** : (1) un import dans le bloc `src/App.tsx:71-83`, (2) un `<Route path="agent-commercial">` (avec enfants imbriqués `prospects`, `pipeline`, `validation`, `exclusions`, `journal`) inséré dans le bloc `/admin` — il héritera automatiquement d'`AdminGuard` et de `AdminLayout`. (3) Ajouter l'entrée au menu (`NAV_ITEMS`, voir §3).

### 2. Auth & rôles

- **Client Supabase** : singleton global dans `src/lib/supabaseClient.ts` (`persistSession`, `autoRefreshToken`, `detectSessionInUrl`), ré-exporté par `src/lib/supabase.ts`. Login via `supabase.auth.signInWithPassword` dans `src/spaces/particulier/pages/ConnexionPage.tsx`, qui écrit aussi `localStorage["mimmoza.user"]` et `localStorage["mimmoza-auth"]`.
- **Le rôle admin est déterminé par TROIS mécanismes incohérents** :

  **A — Table `admin_users`** (`src/lib/admin.ts:31-38`), utilisée par la nav du shell principal :
  ```ts
  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id, email, is_active")
    .eq("user_id", user.id).eq("is_active", true).maybeSingle();
  const isAdmin = Boolean(!error && data);
  ```

  **B — RPC `is_current_user_admin()`** (`src/spaces/admin/services/adminAccess.ts:11`), utilisée par la garde de route :
  ```ts
  const { data, error } = await supabase.rpc("is_current_user_admin");
  return data === true;
  ```

  **C — Allowlist email en dur + localStorage** (`src/spaces/admin/components/AdminGuard.tsx:16-36`), raccourci synchrone :
  ```ts
  const ADMIN_EMAILS: string[] = ["maigre48@gmail.com"];
  // checkLocalAdmin() lit localStorage["mimmoza.user"].logged + email ∈ ADMIN_EMAILS
  ```

  Aucun contrôle via `app_metadata` ni claim JWT dans le front. La définition SQL de `is_current_user_admin()` et le schéma de `admin_users` sont **hors repo**.

- **Garde de route** : `src/spaces/admin/components/AdminGuard.tsx` — fast-path local synchrone, puis `requireAdmin()` async ; états `loading / denied-auth (→ /connexion) / denied-admin (écran « Accès refusé ») / allowed`. Garde générique séparée (non-admin) : `src/components/PrivateRoute.tsx` (localStorage seulement, marquée « à remplacer »).
- **Vérification admin côté Edge Functions : INEXISTANTE.** Aucune des 4 fonctions ayant du code ne vérifie le JWT ni un rôle admin. La seule « auth » serveur est la **vérification de signature Stripe** dans `supabase/functions/stripe-webhook/index.ts` :
  ```ts
  event = await stripe.webhooks.constructEventAsync(body, signature, WEBHOOK_SECRET);
  ```
  Le pattern d'appel authentifié côté client est dans `src/spaces/copilot/lib/copilotClient.ts:38-53` : `Authorization: Bearer <access_token>` + header `apikey`.

### 3. Navigation admin

- **Menu actif** : `NAV_ITEMS` **dans** `src/spaces/admin/components/AdminLayout.tsx:19-29` (le layout contient sa propre sidebar interne). Structure d'entrée : `{ label, path, icon: LucideIcon, end?: boolean }`. Icônes = **lucide-react**. Style actif `bg-slate-950 text-white`, cas spécial violet + badge « V1 » pour Copilot.
- **Deux sidebars mortes/legacy** : `src/spaces/admin/components/AdminSidebar.tsx` et `src/components/admin/AdminSidebar.tsx` (non importées par le layout routé).
- **Masquage non-admin** : à l'intérieur de `/admin`, **pas de filtrage par entrée** — tout est gardé en bloc par `AdminGuard`. Le bouton « Admin » du shell principal est conditionné par `{isAdmin && (…)}` dans `src/components/AppShell.tsx` (`isAdmin` alimenté par `getCurrentAdminStatus()` → table `admin_users`). **Incohérence notable** : le shell utilise la table `admin_users`, la garde de route utilise la RPC + l'email en dur → sources de vérité divergentes.

### 4. Design system

- **Primitives réutilisables** dans `src/components/layouts/` : `Card` (+ `CardHeader/Title/Body/Footer`), `StatCard`, `LoadingState` (unique spinner), `EmptyState`, `Grid`, `ContentSection`, `PageContainer`. Admin : `StatusBadge` (tons `emerald|amber|rose|slate|sky|violet`), `AdminStatCard`. `src/components/ui/` ne contient que `ScoreTooltip.tsx`.
- **N'existent PAS** (à créer) : `Button`, `Table`, `Modal/Dialog`, `Input`, skeleton, **système de toasts** (aucune lib ; erreurs = `<div>` colorés inline). `src/spaces/admin/components/AdminTable.tsx` est **un fichier vide**.
- **Tables** : hand-rolled par page (ex. `src/spaces/admin/pages/Utilisateurs.tsx`) — filtre texte client-side via `useMemo`, mais **ni tri de colonnes ni pagination**. Modales dupliquées inline (overlay `fixed inset-0 bg-black/30 backdrop-blur-sm`).
- **Kanban / DnD** : **aucune lib DnD**. Un board en colonnes existe déjà — `src/spaces/marchand/pages/Pipeline.tsx` — `COLUMNS: DealStatus[] = ["Nouveau","Visite","Offre","Sous promesse","Travaux","En vente","Vendu"]`, mais **sans drag** (changement de statut via `<select>`). C'est l'analogue le plus proche pour le pipeline commercial.
- **Tailwind** : `theme.extend` **vide** dans `tailwind.config.js` et `.cjs` → **palette Tailwind standard**, aucun token custom. Thème admin = **clair** : `bg-slate-50`, cartes `bg-white` très arrondies (`rounded-[28px]/[32px]/3xl`), bordures `slate-200`, accent `slate-950`, violet pour l'IA.

### 5. Supabase

- **Migrations** : dossier `supabase/migrations/`, 3 conventions de nommage mélangées (`001_billing.sql`, `api_keys.sql`, `20260611_knowledge_graph.sql`) mais **tous vides**. `src/lib/billing/billing_schema.sql` aussi vide. **Le schéma réel est géré dans le dashboard Supabase**, documenté seulement en **commentaires SQL dans des fichiers TS**.
- **Conventions déduites des interfaces TS** (ex. `src/features/admin/billing/types.ts`, `src/spaces/apporteur/shared/apporteurDeals.store.ts`) : PK `id` UUID (`string`), colonnes **snake_case**, `created_at` + `updated_at` omniprésents, propriété via `user_id` / `recipient_user_id` (+ `organization_id`), montants en **centimes** (`amount_ht_cents`, `vat_rate_bps`), statuts = **unions de chaînes TS** (impossible de savoir ENUM Postgres vs CHECK — pas de DDL). **Pas de soft-delete** (suppressions dures), **pas de `created_by`/`updated_by`**, triggers `updated_at` non visibles.
- **Modèle RLS** : le **seul** exemple RLS du repo est un **commentaire** dans `src/lib/access/audit.ts:132-156` — table `access_audit_log` (`id uuid default gen_random_uuid()`, …, `metadata jsonb`, `created_at timestamptz default now()`) avec `create policy "Admin only" … using (auth.jwt() ->> 'role' = 'admin')`. **Non exécuté**, et incohérent avec les mécanismes A/B ci-dessus.
- **Tables existantes proches du besoin** (recensées via `supabase.from(...)`) :
  - **`apporteur_deals`** (+ vue `v_apporteur_deals_pool`) — pipeline/lead avec `status` (`depose→en_etude→qualifie→transmis_promoteur→refuse`), `apporteur_name/email/phone`, commissions. **Le CRM-pipeline le plus abouti.**
  - **`opportunity_watches` / `opportunity_watch_events`** — veilles + événements avec `frequency (daily|weekly)`, `notify_email`, `last_run_at`, événements `seen`, run via Edge Function `opportunity-watch-run`. **Excellent gabarit pour relances + journal.**
  - **`maires_rne`** + Edge Function `recherche-contacts-mairies-v1` — annuaire de contacts (source de prospects potentielle).
  - `quotes`/`invoices` (portent `contact_name`, `contact_email`, `company_name`, `target_space`), `access_audit_log` (journalisation), `credit_accounts`/`credit_transactions`/`token_ledger`/`billing_profiles` (crédits).
  - **Aucune** table dédiée `prospects` / `leads` / `contacts` / `crm_*`.

### 6. Edge Functions

- **Inventaire** (code réellement présent en gras) : **`cadastre-geojson-proxy`** (proxy CORS cadastre, `verify_jwt=false`), **`smartscore-enriched-v3`** (orchestrateur de scoring, 1666 lignes, open-data uniquement), **`stripe-create-checkout`**, **`stripe-webhook`**. Vides : `api-gateway`, `cadastre-from-commune`, `synthesis-promoteur-v1`, `valuation-engine`, `_shared`. Invoquées mais hors repo : `copilot-chat`, `opportunity-watch-run`, `stripe-billing-portal`, `plu-*`, `sitadel-v1`, etc.
- **Anatomie type** (via `supabase/functions/stripe-webhook/index.ts`) : `serve()` Deno, client **service-role** (`createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`), secrets par `Deno.env.get(...)`, rejet non-POST (405), parsing `await req.text()/.json()`, **idempotence via table `stripe_webhook_logs`**, erreurs `try/catch` + `console.error` + log en base. CORS : soit inline (`Access-Control-Allow-Origin: *` dans `cadastre-geojson-proxy`), soit importé du `_shared` manquant (`smartscore`). Résolution multi-noms de la service-role key dans `smartscore-enriched-v3:64-73`.
- **IA aujourd'hui** : **aucun appel LLM dans les Edge Functions du repo** (0 occurrence de `openai/anthropic/claude/gpt`). L'IA runtime produit (`copilot-chat`) est **déployée hors repo** — appelée en **SSE streaming** depuis `src/spaces/copilot/lib/copilotClient.ts:200`. Les indices (coûts, commentaires `adminCopilot.ts`, `actionCosts.ts`) pointent vers **Anthropic Claude (Sonnet)**. Seul code LLM en repo : l'outil dev `tools/ai-orchestrator/run.mjs` — Anthropic, `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`, JSON structuré, **sans retry ni timeout**.
- **Ledger jetons/crédits** : débit/crédit serveur via RPC `apply_token_ledger_entry` (`stripe-webhook:66-84`), miroir client dans `src/lib/billing/tokenLedger.ts`, coûts par action dans `src/lib/billing/actionCosts.ts` (`copilot_quick:5`, `copilot_advanced:15`, `analyse_rapide:10`…). Solde = `billing_profiles.token_balance` / `credit_accounts.current_credits`. **Admins bypassent** (`bypassTokens` dans `lib/admin.ts`).

### 7. Tâches planifiées

- **Aucune.** `supabase/config.toml` = uniquement `[functions.cadastre-geojson-proxy] verify_jwt=false`. `vercel.json` = rewrites SPA, **pas de `crons`**. **Pas de `.github/workflows`**. Pas de `pg_cron` (migrations vides). Seule mention : un **commentaire** d'intention (`pipeline_alerts_v4.ts:8`). `opportunity-watch-run` est invoquée **à la demande** (`runWatchNow`), pas planifiée.

### 8. Tooling

- **Scripts** : `dev/build (tsc -b && vite build)/lint/preview`. **Pas de script de test.**
- **Lint** : `eslint.config.js` flat (`@eslint/js` + `typescript-eslint` + `react-hooks` + `react-refresh`), ignore `dist`.
- **Build** : `vite.config.ts`, alias `@ → ./src`. `middleware.ts` = Basic-Auth Vercel pour protéger la preview.
- **Tests** : **aucun runner installé.** Un seul `*.test.ts` (`src/spaces/marchand/scoring/sourcingSmartScore.engine.test.ts`) importe `vitest` — **mais `vitest` n'est pas dans les dépendances** → non exécutable. Couverture nulle.

---

## B. Contraintes & conventions à respecter impérativement

1. **Route sous `/admin/*`**, imbriquée dans le bloc gardé de `src/App.tsx` + entrée dans `NAV_ITEMS` de `AdminLayout.tsx`. Icône lucide-react.
2. **Thème admin clair**, palette Tailwind standard, cartes `bg-white rounded-[28px] border-slate-200 shadow-sm`, accent `slate-950`. Réutiliser `Card/StatCard/StatusBadge/EmptyState/LoadingState`.
3. **Services front = `supabase.from(...)` / `supabase.rpc(...)`** typés, en snake_case, avec `id` uuid, `created_at/updated_at`, `user_id`. Erreurs remontées via `throw new Error(error.message)`.
4. **Edge Functions** : Deno `serve`, client service-role, secrets `Deno.env.get`, CORS explicite, idempotence par table de logs, `try/catch` + `console.error`. **Ajouter une vérif admin serveur** (aujourd'hui absente — cf. F).
5. **Séparation obligatoire génération IA / envoi** : validation humaine avant tout envoi (exigence produit) — modéliser un statut de brouillon distinct de l'envoi.
6. **Journalisation** : suivre le gabarit `access_audit_log` (append-only, jsonb `metadata`, non bloquant).
7. **Pas de soft-delete** dans les conventions actuelles → utiliser des statuts terminaux (ou décider d'introduire l'archivage, cf. F).
8. **Le schéma vit dans le dashboard** : toute table créée doit être scriptée **et** décidée quant à son mode de gestion (cf. F).

## C. Réutilisable vs à créer

**Réutilisable tel quel** : `AdminGuard` + route gardée ; `AdminLayout`/`NAV_ITEMS` ; primitives `Card/StatCard/StatusBadge/EmptyState/LoadingState/Grid/PageContainer` ; pattern service Supabase ; gabarit `opportunity_watches/_events` (relances + journal) ; gabarit `apporteur_deals` (pipeline/statuts) ; pattern Edge Function (`stripe-webhook`) ; pattern client authentifié SSE (`copilotClient`) ; ledger `apply_token_ledger_entry` (si facturation voulue) ; `maires_rne`/`recherche-contacts-mairies-v1` (enrichissement contacts).

**À créer** : tables `prospects` + pipeline + emails + exclusions + journal (+ RLS) ; primitives UI `Table` (tri/filtre/pagination), `Modal`, `Button`, `Input`, système de **toasts** ; Edge Functions `agent-commercial-*` (génération IA, envoi Gmail, run relances) **avec vérif admin serveur** ; **intégration d'envoi Gmail** (aucune infra email n'existe) ; **mécanisme cron** (aucun n'existe) ; éventuellement lib DnD si drag voulu.

## D. Plan d'implémentation (phases 2 → 7)

> Découpage indicatif ; chaque phase suppose un accord préalable sur les points F.

- **Phase 2 — Socle données + navigation (squelette).**
  Fichiers : `src/App.tsx` (route), `AdminLayout.tsx` (nav), `src/spaces/admin/pages/agentCommercial/*` (pages vides), `src/spaces/admin/services/agentCommercial/*.ts`, `src/spaces/admin/types/agentCommercial.types.ts`.
  Migrations : tables `commercial_prospects`, `commercial_pipeline_stages` (ou statut enum), `commercial_exclusions`, `commercial_activity_log` + RLS admin. **Décision cron/gestion migrations à trancher avant.**
  Risques : divergence des 3 mécanismes admin ; migrations non versionnées → schéma dérive.

- **Phase 3 — Prospects & liste d'exclusion.**
  CRUD prospects, import (CSV via `csv-parse` déjà présent), déduplication, contrôle exclusion à l'insertion.
  Fichiers : pages Prospects/Exclusions + services. Migration : contraintes d'unicité + index.
  Risques : RGPD (données de prospection B2B), doublons, source des données de prospects (cf. F).

- **Phase 4 — Pipeline.**
  Board en colonnes calqué sur `Pipeline.tsx` ; changement de statut d'abord via menu (comme l'existant), DnD optionnel.
  Fichiers : page Pipeline + composant board. Migration : historisation des transitions dans `commercial_activity_log`.
  Risques : décider DnD custom vs lib (`@dnd-kit`).

- **Phase 5 — Génération d'emails IA + file de validation.**
  Edge Function `agent-commercial-generate` (Anthropic, JSON structuré, retries/timeout — à durcir vs le dev tool actuel). Statut brouillon `draft → pending_review`. UI de relecture/édition.
  Fichiers : fonction + service + page Validation. Migration : table `commercial_emails` (statut, corps, tokens).
  Risques : **provider/clé IA côté serveur à confirmer** ; coût/facturation (ledger ?) ; qualité/hallucinations.

- **Phase 6 — Envoi Gmail + journalisation.**
  Edge Function `agent-commercial-send` envoyant via `commercial@mimmoza.fr` **après validation humaine uniquement** ; log d'envoi, gestion d'erreurs, idempotence (gabarit `stripe_webhook_logs`).
  Fichiers : fonction + service + statut `sent/failed`. Migration : colonnes d'envoi + `commercial_send_log`.
  Risques : **mécanisme d'envoi non défini** (Gmail API OAuth vs SMTP vs Workspace) — bloquant ; délivrabilité/SPF/DKIM ; secrets.

- **Phase 7 — Relances + planification + tableau de bord.**
  Edge Function `agent-commercial-run-followups` (calquée sur `opportunity-watch-run`), planifiée. Dashboard (KPIs via `StatCard`) + journal complet.
  Fichiers : fonction + page Dashboard/Journal. Migration : `last_run_at`, règles de relance, éventuel `pg_cron`.
  Risques : **aucun cron n'existe** — choix d'infra à faire ; boucles d'envoi non maîtrisées ; fenêtres anti-spam.

## E. Schéma de données proposé (texte, confronté aux conventions §5)

Conventions appliquées : `id uuid default gen_random_uuid()`, `created_at/updated_at timestamptz default now()`, snake_case, ownership `created_by uuid` (auth.uid), `metadata jsonb`, statuts en CHECK **ou** enum (à trancher, cf. F), RLS « admin only ».

- **`commercial_prospects`** : `id`, `company_name`, `contact_name`, `contact_email`, `contact_phone`, `siren?`, `city`, `zip_code`, `source` (`import|manual|maires_rne|…`), `status` (`nouveau|contacte|en_discussion|gagne|perdu`), `owner_id?`, `notes?`, `metadata jsonb`, `created_by`, `created_at`, `updated_at`. Unicité douce sur `(contact_email)` / `(siren)`.
- **`commercial_pipeline_events`** : `id`, `prospect_id (fk)`, `from_status`, `to_status`, `moved_by`, `created_at`. (Historisation, calquée sur la logique `apporteur_deals`.)
- **`commercial_emails`** : `id`, `prospect_id (fk)`, `kind` (`premier_contact|relance`), `subject`, `body`, `status` (`draft|pending_review|approved|sent|failed|cancelled`), `ai_model`, `tokens_in`, `tokens_out`, `generated_by`, `reviewed_by?`, `sent_at?`, `error?`, `metadata jsonb`, `created_at`, `updated_at`. **`status` sépare génération et envoi (validation humaine).**
- **`commercial_send_log`** : `id`, `email_id (fk)`, `provider_message_id?`, `to_email`, `from_email` (`commercial@mimmoza.fr`), `success bool`, `error?`, `payload jsonb`, `created_at`. Idempotence (gabarit `stripe_webhook_logs`).
- **`commercial_exclusions`** : `id`, `email?`, `domain?`, `siren?`, `reason`, `created_by`, `created_at`. Consultée avant génération/envoi.
- **`commercial_followup_rules`** (Phase 7) : `id`, `label`, `delay_days`, `max_relances`, `active bool`, `last_run_at`, `created_at`, `updated_at` (calqué sur `opportunity_watches`).
- **`commercial_activity_log`** : append-only, calqué sur `access_audit_log` (`event_type`, `entity`, `entity_id`, `actor_id`, `metadata jsonb`, `created_at`).

## F. Points de décision nécessitant ton arbitrage AVANT tout code

1. **Gestion du schéma** : on continue en **SQL dashboard** (migrations vides, comme aujourd'hui) ou on **introduit de vraies migrations versionnées** pour ce module ? Cela conditionne toute la Phase 2.
2. **Standardisation de l'auth admin** : je m'aligne sur quoi — **table `admin_users`**, **RPC `is_current_user_admin()`**, ou l'email en dur ? Et surtout : **les nouvelles Edge Functions doivent vérifier l'admin côté serveur** (aucune ne le fait) — OK pour créer un helper `_shared/requireAdmin` (vérif JWT → RPC/`admin_users`) ?
3. **Envoi Gmail via `commercial@mimmoza.fr`** : quel mécanisme — **Gmail API (OAuth2 / service account Workspace)**, **SMTP applicatif**, ou un relais tiers ? Y a-t-il déjà des identifiants/domaine configurés (SPF/DKIM) ? **Bloquant pour la Phase 6.**
4. **Provider IA runtime** : je confirme **Anthropic Claude** (cohérent avec le copilot) ? Quel modèle ? Le code de `copilot-chat` (hors repo) doit-il être ma référence, et puis-je y accéder ?
5. **Facturation/jetons** : le module est **interne admin** → je pars sur **bypass crédits** (pas de débit `token_ledger`) ? Ou tu veux un suivi de coût IA façon `adminCopilot` ?
6. **Cron des relances** : **pg_cron** (Supabase), **Vercel Cron**, ou déclenchement manuel comme `opportunity-watch-run` en Phase 7 ? Aucun n'existe aujourd'hui.
7. **Pipeline** : drag & drop réel (⇒ ajouter `@dnd-kit`) ou changement de statut par menu (comme l'existant, zéro dépendance) ?
8. **Source des prospects** : saisie manuelle, **import CSV**, réutilisation de `maires_rne`/`recherche-contacts-mairies-v1`, ou autre ? Cela dimensionne la Phase 3 et le volet RGPD.
9. **Primitives UI** : je crée des composants partagés (`Table` triable/paginée, `Modal`, `Toast`) réutilisables — dans `src/components/ui/` — ou je reste sur le hand-rolled par page comme le reste de l'admin ?

## G. Zones d'incertitude (non trouvé / non compris)

- **Schéma DB réel introuvable** : toutes les tables/RLS/enums/triggers sont hors repo (dashboard). Je ne peux pas confirmer ENUM vs CHECK, la présence de triggers `updated_at`, ni les policies réelles de `admin_users`/`access_audit_log`.
- **`is_current_user_admin()`** : définition SQL non présente → je ne sais pas sur quoi elle se base (probablement `admin_users`, non vérifiable ici).
- **`copilot-chat` (IA runtime)** : source absente → provider exact, modèle, streaming, retries, timeouts, débit crédits **non citables** depuis le repo (seulement inférés).
- **Infra email** : **aucune** trace d'envoi d'email (Gmail/SMTP/Resend/SendGrid) dans le code — j'ignore s'il existe déjà des credentials/config pour `commercial@mimmoza.fr`.
- **Dossiers de fonctions vides** (`api-gateway`, `valuation-engine`, etc.) : leur code déployé existe mais je ne peux pas l'auditer.
- **Cohérence multi-sidebars/multi-admin-checks** : trois sidebars et trois checks admin coexistent ; je ne sais pas lesquels sont considérés « officiels ».
- **Tests** : le seul test existant ne tourne pas (vitest absent) — pas de socle de test à étendre.
