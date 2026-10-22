// supabase/functions/emails-cycle-vie/index.ts
// =============================================================================
// E-MAILS DE CYCLE DE VIE MIMMOZA (bienvenue, première analyse, rappel,
// quota 80 % / 100 %, solde de jetons bas) — envoi via Resend.
// =============================================================================
//
// Trois façons d'appeler cette fonction (déployée avec --no-verify-jwt : elle
// contrôle elle-même chaque accès) :
//
//  1. CRON quotidien (pg_cron + pg_net) — en-tête `x-cron-secret` = EMAILS_CRON_SECRET.
//     Corps : {} ou { "simulation": true } (rien n'est envoyé ni enregistré,
//     la réponse liste ce qui PARTIRAIT).
//  2. APPEL PONCTUEL d'un utilisateur connecté (Authorization: Bearer <jwt>) :
//     { "evenement": "connexion" } → règles évaluées pour LUI SEUL (ex. bienvenue
//     juste après la confirmation). Un administrateur peut passer { "userId", "simulation" }.
//  3. DÉSINSCRIPTION (lien signé, sans connexion) :
//     GET  ?action=desinscription&u=&c=&t=  → page de confirmation (bouton) ;
//     POST même URL                          → désinscription (et « un clic » RFC 8058).
//
// Garanties :
//   · idempotente : table email_envois, unicité (user_id, type, cle_periode, mode) ;
//     la ligne est RÉSERVÉE avant l'envoi, puis passée à « envoye » ou « echec » ;
//   · respecte email_preferences (conseils / alertes_usage) ;
//   · au plus un e-mail non transactionnel par jour et par personne (règles pures,
//     _shared/emails/regles.ts) ;
//   · MODE ESSAI PAR DÉFAUT : tant que EMAILS_MODE ≠ "production", tout part à
//     EMAILS_ADMIN_TO (sujet préfixé « [ESSAI → destinataire] »), au plus 20 par passage.
//
// Secrets : RESEND_API_KEY, EMAIL_FROM, EMAILS_CRON_SECRET, EMAILS_SECRET_DESINSCRIPTION,
//           EMAILS_ADMIN_TO, EMAILS_MODE (essai|production), APP_URL, EMAIL_REPLY_TO (option).
// =============================================================================

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  type Decision,
  type EnvoiPasse,
  type ProfilEnvoi,
  type TypeEmail,
  CATEGORIE_EMAIL,
  TYPES_EMAIL,
  formuleActive,
  moisUtc,
  selectionner,
} from "../_shared/emails/regles.ts";
import { rendreEmail } from "../_shared/emails/gabarits.ts";
import {
  type CategorieDesactivable,
  LIBELLE_CATEGORIE,
  lienDesinscription,
  verifier,
} from "../_shared/emails/desinscription.ts";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const env = (k: string) => (Deno.env.get(k) ?? "").trim();

function premiereCleJson(v: string): string | null {
  if (!v) return null;
  try {
    const o = JSON.parse(v) as Record<string, unknown>;
    for (const val of Object.values(o)) if (typeof val === "string" && val) return val;
  } catch { /* pas du JSON */ }
  return null;
}

function cleService(): string {
  // Projet sur JWT Signing Keys : SUPABASE_SECRET_KEYS en priorité (cf. copilot-chat).
  const k = premiereCleJson(env("SUPABASE_SECRET_KEYS")) ?? (env("SUPABASE_SERVICE_ROLE_KEY") || null);
  if (!k) throw new Error("Clé de service Supabase absente.");
  return k;
}

function admin(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), cleService(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function json(corps: unknown, status = 200): Response {
  return new Response(JSON.stringify(corps), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function egal(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const MODE = env("EMAILS_MODE") === "production" ? "production" : "essai";
const MAX_ESSAI = 20;
const MAX_PAR_PASSAGE = 500;
const JOUR = 24 * 3600 * 1000;

function urlFonction(): string {
  return `${env("SUPABASE_URL").replace(/\/+$/, "")}/functions/v1/emails-cycle-vie`;
}

// ── Chargement des profils d'envoi ───────────────────────────────────────────

interface Utilisateur {
  id: string;
  email: string | null;
  created_at: string;
  email_confirmed_at: string | null;
  nom: string | null;
}

async function listerUtilisateurs(db: SupabaseClient, seul?: string): Promise<Utilisateur[]> {
  const map = (u: { id: string; email?: string | null; created_at: string; email_confirmed_at?: string | null; user_metadata?: Record<string, unknown> }) => ({
    id: u.id,
    email: u.email ?? null,
    created_at: u.created_at,
    email_confirmed_at: u.email_confirmed_at ?? null,
    nom: typeof u.user_metadata?.full_name === "string" ? (u.user_metadata.full_name as string) : null,
  });
  if (seul) {
    const { data, error } = await db.auth.admin.getUserById(seul);
    if (error || !data.user) return [];
    return [map(data.user)];
  }
  const tous: Utilisateur[] = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    tous.push(...data.users.map(map));
    if (data.users.length < 1000) break;
  }
  return tous;
}

function parUtilisateur<T extends { user_id: string }>(lignes: T[] | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const l of lignes ?? []) {
    const arr = m.get(l.user_id) ?? [];
    arr.push(l);
    m.set(l.user_id, arr);
  }
  return m;
}

async function chargerProfils(db: SupabaseClient, utilisateurs: Utilisateur[], maintenant: Date): Promise<ProfilEnvoi[]> {
  if (!utilisateurs.length) return [];
  const ids = utilisateurs.map((u) => u.id);
  const mois = `${moisUtc(maintenant)}-01`;
  const il30j = new Date(maintenant.getTime() - 30 * JOUR).toISOString();

  // Requêtes par paquets de 200 identifiants (limite d'URL PostgREST).
  const paquets: string[][] = [];
  for (let i = 0; i < ids.length; i += 200) paquets.push(ids.slice(i, i + 200));

  const lignes = async <T>(table: string, colonnes: string, filtre?: (q: any) => any): Promise<T[]> => {
    const out: T[] = [];
    for (const p of paquets) {
      let q = db.from(table).select(colonnes).in("user_id", p);
      if (filtre) q = filtre(q);
      const { data, error } = await q;
      if (error) {
        // Une table absente (migration non appliquée) ne bloque pas le reste.
        console.warn(`[emails-cycle-vie] lecture ${table} :`, error.message);
        continue;
      }
      out.push(...((data ?? []) as T[]));
    }
    return out;
  };

  const [profils, billing, comptes, usage, tickets, debits, conversations, envois, prefs] = await Promise.all([
    (async () => {
      const out: { id: string; full_name: string | null }[] = [];
      for (const p of paquets) {
        const { data } = await db.from("users_profiles").select("id, full_name").in("id", p);
        out.push(...((data ?? []) as { id: string; full_name: string | null }[]));
      }
      return out;
    })(),
    lignes<{ user_id: string; plan_code: string | null; subscription_status: string | null }>(
      "billing_profiles", "user_id, plan_code, subscription_status"),
    lignes<{ user_id: string; current_credits: number | null }>("credit_accounts", "user_id, current_credits"),
    lignes<{ user_id: string; nb: number }>("free_quick_analysis_usage", "user_id, nb", (q) => q.eq("mois", mois)),
    lignes<{ user_id: string }>("quick_analysis_tickets", "user_id"),
    lignes<{ user_id: string; type: string; amount: number; created_at: string }>(
      "credit_transactions", "user_id, type, amount, created_at", (q) => q.gte("created_at", il30j)),
    lignes<{ user_id: string; id: string; created_at: string }>(
      "copilot_conversations", "user_id, id, created_at", (q) => q.order("created_at", { ascending: true })),
    lignes<{ user_id: string; type: TypeEmail; cle_periode: string; envoye_le: string; statut: string; mode: string }>(
      "email_envois", "user_id, type, cle_periode, envoye_le, statut, mode", (q) => q.eq("mode", MODE)),
    lignes<{ user_id: string; conseils: boolean; alertes_usage: boolean }>(
      "email_preferences", "user_id, conseils, alertes_usage"),
  ]);

  const nomParId = new Map(profils.map((p) => [p.id, p.full_name]));
  const billingPar = parUtilisateur(billing);
  const comptePar = parUtilisateur(comptes);
  const usagePar = parUtilisateur(usage);
  const ticketsPar = parUtilisateur(tickets);
  const debitsPar = parUtilisateur(debits);
  const convPar = parUtilisateur(conversations);
  const envoisPar = parUtilisateur(envois);
  const prefsPar = parUtilisateur(prefs);

  return utilisateurs.map((u) => {
    const bp = billingPar.get(u.id)?.[0];
    const dep = debitsPar.get(u.id) ?? [];
    const convs = convPar.get(u.id) ?? [];
    const pref = prefsPar.get(u.id)?.[0];
    const nom = (nomParId.get(u.id) ?? u.nom ?? "").trim();
    const compte = comptePar.get(u.id)?.[0];
    const envoisPasses: EnvoiPasse[] = (envoisPar.get(u.id) ?? [])
      .filter((e) => e.statut === "envoye" || e.statut === "en_cours")
      .map((e) => ({ type: e.type, cle: e.cle_periode, envoyeLe: e.envoye_le }));
    return {
      userId: u.id,
      email: u.email,
      prenom: nom ? nom.split(/\s+/)[0] : null,
      inscritLe: u.created_at,
      confirmeLe: u.email_confirmed_at,
      formule: formuleActive(bp?.plan_code, bp?.subscription_status),
      analysesMois: usagePar.get(u.id)?.[0]?.nb ?? 0,
      analysesTotal: (ticketsPar.get(u.id)?.length ?? 0) + dep.filter((d) => d.type === "quick_analysis").length,
      soldeJetons: typeof compte?.current_credits === "number" ? compte.current_credits : null,
      depensesJetons30j: dep.filter((d) => d.amount < 0).length,
      nbConversations: convs.length,
      premiereConversation: convs[0] ? { id: convs[0].id, creeLe: convs[0].created_at } : null,
      preferences: { conseils: pref?.conseils ?? true, alertes_usage: pref?.alertes_usage ?? true },
      envois: envoisPasses,
    } satisfies ProfilEnvoi;
  });
}

// ── Envoi ────────────────────────────────────────────────────────────────────

interface Resultat {
  userId: string;
  type: TypeEmail;
  cle: string;
  statut: "simule" | "envoye" | "echec" | "deja_reserve" | "ignore";
  detail?: string;
}

async function reserver(db: SupabaseClient, p: ProfilEnvoi, d: Decision, destinataire: string): Promise<string | null> {
  const ligne = {
    user_id: p.userId,
    type: d.type,
    cle_periode: d.cle,
    mode: MODE,
    transactionnel: d.transactionnel,
    destinataire,
    statut: "en_cours",
  };
  const { data, error } = await db
    .from("email_envois")
    .upsert(ligne, { onConflict: "user_id,type,cle_periode,mode", ignoreDuplicates: true })
    .select("id");
  if (error) throw error;
  if (data && data.length) return (data[0] as { id: string }).id;
  // Ligne existante : on ne la reprend que si l'envoi précédent a échoué (3 tentatives au plus).
  const { data: repris } = await db
    .from("email_envois")
    .select("id, tentatives")
    .eq("user_id", p.userId).eq("type", d.type).eq("cle_periode", d.cle).eq("mode", MODE)
    .eq("statut", "echec").lt("tentatives", 3)
    .maybeSingle();
  if (!repris) return null;
  const { data: maj } = await db
    .from("email_envois")
    .update({ statut: "en_cours", tentatives: (repris as { tentatives: number }).tentatives + 1, maj_le: new Date().toISOString() })
    .eq("id", (repris as { id: string }).id).eq("statut", "echec")
    .select("id");
  return maj && maj.length ? (maj[0] as { id: string }).id : null;
}

async function envoyerResend(params: {
  a: string;
  sujet: string;
  html: string;
  texte: string;
  desinscription: string | null;
  cleIdempotence: string;
  type: TypeEmail;
}): Promise<string> {
  const headers: Record<string, string> = {};
  if (params.desinscription) {
    headers["List-Unsubscribe"] = `<${params.desinscription}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
      "Idempotency-Key": params.cleIdempotence.slice(0, 256),
    },
    body: JSON.stringify({
      from: env("EMAIL_FROM"),
      to: [params.a],
      reply_to: env("EMAIL_REPLY_TO") || "contact@mimmoza.fr",
      subject: params.sujet,
      html: params.html,
      text: params.texte,
      headers,
      tags: [{ name: "type", value: params.type }],
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((data as { message?: string })?.message ?? `Resend HTTP ${resp.status}`);
  return (data as { id?: string })?.id ?? "";
}

async function traiter(db: SupabaseClient, profils: ProfilEnvoi[], maintenant: Date, simulation: boolean): Promise<Resultat[]> {
  const resultats: Resultat[] = [];
  const appUrl = (env("APP_URL") || "https://mimmoza.vercel.app").replace(/\/+$/, "");
  const secret = env("EMAILS_SECRET_DESINSCRIPTION");
  const adminTo = env("EMAILS_ADMIN_TO");
  let envoyes = 0;

  if (!simulation) {
    const manque = ["RESEND_API_KEY", "EMAIL_FROM", "EMAILS_SECRET_DESINSCRIPTION"].filter((k) => !env(k));
    if (MODE === "essai" && !adminTo) manque.push("EMAILS_ADMIN_TO");
    if (manque.length) throw new Error(`Secrets manquants : ${manque.join(", ")}.`);
  }

  for (const p of profils) {
    for (const d of selectionner(p, maintenant)) {
      if (envoyes >= (MODE === "essai" ? MAX_ESSAI : MAX_PAR_PASSAGE)) {
        resultats.push({ userId: p.userId, type: d.type, cle: d.cle, statut: "ignore", detail: "plafond du passage atteint" });
        continue;
      }
      if (simulation) {
        resultats.push({ userId: p.userId, type: d.type, cle: d.cle, statut: "simule" });
        continue;
      }
      const categorie = CATEGORIE_EMAIL[d.type];
      const lien = categorie === "compte"
        ? null
        : await lienDesinscription(urlFonction(), secret, p.userId, categorie as CategorieDesactivable);
      const rendu = rendreEmail(d.type, {
        appUrl,
        prenom: p.prenom,
        formule: p.formule,
        analysesMois: p.analysesMois,
        soldeJetons: p.soldeJetons,
        conversationId: p.premiereConversation?.id ?? null,
        lienDesinscription: lien,
        maintenant,
      });
      const destinataire = MODE === "essai" ? adminTo : p.email!;
      const sujet = MODE === "essai" ? `[ESSAI → ${p.email}] ${rendu.sujet}` : rendu.sujet;

      let id: string | null;
      try {
        id = await reserver(db, p, d, destinataire);
      } catch (e) {
        resultats.push({ userId: p.userId, type: d.type, cle: d.cle, statut: "echec", detail: `réservation : ${(e as Error).message}` });
        continue;
      }
      if (!id) {
        resultats.push({ userId: p.userId, type: d.type, cle: d.cle, statut: "deja_reserve" });
        continue;
      }
      try {
        const fournisseurId = await envoyerResend({
          a: destinataire,
          sujet,
          html: rendu.html,
          texte: rendu.texte,
          desinscription: lien,
          cleIdempotence: `${p.userId}-${d.type}-${d.cle}-${MODE}`,
          type: d.type,
        });
        await db.from("email_envois").update({
          statut: "envoye", fournisseur_id: fournisseurId, envoye_le: new Date().toISOString(),
          maj_le: new Date().toISOString(), erreur: null,
        }).eq("id", id);
        envoyes++;
        resultats.push({ userId: p.userId, type: d.type, cle: d.cle, statut: "envoye" });
        // Un seul e-mail non transactionnel par jour : la règle relit l'historique
        // au prochain passage ; dans ce passage, selectionner() n'en a rendu qu'un.
      } catch (e) {
        const msg = (e as Error).message;
        await db.from("email_envois").update({ statut: "echec", erreur: msg.slice(0, 500), maj_le: new Date().toISOString() }).eq("id", id);
        resultats.push({ userId: p.userId, type: d.type, cle: d.cle, statut: "echec", detail: msg });
      }
    }
  }
  return resultats;
}

// ── Désinscription ───────────────────────────────────────────────────────────

function page(titre: string, corps: string, status = 200): Response {
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titre} — Mimmoza</title></head>
<body style="margin:0;background:#f4f4fa;font-family:Arial,Helvetica,sans-serif;color:#1f2147;">
<main style="max-width:520px;margin:48px auto;padding:28px;background:#fff;border-radius:14px;border-top:5px solid #5b4bd6;">
<p style="margin:0 0 18px;font-weight:bold;color:#5b4bd6;font-size:20px;">Mimmoza</p>
<h1 style="font-size:21px;margin:0 0 14px;">${titre}</h1>${corps}</main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function desinscription(req: Request, url: URL): Promise<Response> {
  const u = url.searchParams.get("u") ?? "";
  const c = url.searchParams.get("c") ?? "";
  const t = url.searchParams.get("t") ?? "";
  if (!(await verifier(env("EMAILS_SECRET_DESINSCRIPTION"), u, c, t))) {
    return page("Lien invalide", `<p>Ce lien de désinscription n'est pas valide. Écrivez-nous à contact@mimmoza.fr, nous le ferons pour vous.</p>`, 400);
  }
  const libelle = LIBELLE_CATEGORIE[c as CategorieDesactivable];
  if (req.method === "GET") {
    // Pas de désinscription sur un simple GET : les antivirus de messagerie ouvrent les liens.
    return page(
      "Se désinscrire",
      `<p style="line-height:1.6;">Vous ne recevrez plus les e-mails de <strong>${libelle}</strong>. ` +
        `Les e-mails liés au fonctionnement de votre compte continueront d'arriver.</p>` +
        `<form method="post" action="${url.pathname}${url.search}"><button type="submit" ` +
        `style="margin-top:12px;padding:12px 20px;border:0;border-radius:8px;background:#5b4bd6;color:#fff;font-weight:bold;font-size:15px;cursor:pointer;">` +
        `Confirmer la désinscription</button></form>`,
    );
  }
  const db = admin();
  const { error } = await db
    .from("email_preferences")
    .upsert({ user_id: u, [c]: false, maj_le: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) {
    console.error("[emails-cycle-vie] désinscription :", error.message);
    return page("Une erreur est survenue", `<p>Réessayez dans un instant, ou écrivez-nous à contact@mimmoza.fr.</p>`, 500);
  }
  return page("C'est fait", `<p style="line-height:1.6;">Vous ne recevrez plus les e-mails de <strong>${libelle}</strong>.</p>`);
}

// ── Point d'entrée ───────────────────────────────────────────────────────────

async function estAdmin(db: SupabaseClient, userId: string): Promise<boolean> {
  const [{ data: a }, { data: b }] = await Promise.all([
    db.from("admin_users").select("user_id").eq("user_id", userId).eq("is_active", true).maybeSingle(),
    db.from("billing_profiles").select("is_admin").eq("user_id", userId).maybeSingle(),
  ]);
  return Boolean(a) || Boolean((b as { is_admin?: boolean } | null)?.is_admin);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);

  try {
    if (url.searchParams.get("action") === "desinscription") return await desinscription(req, url);
    if (req.method !== "POST") return json({ ok: false, erreur: "Méthode non autorisée." }, 405);

    const corps = (await req.json().catch(() => ({}))) as { simulation?: boolean; evenement?: string; userId?: string };
    const db = admin();
    const maintenant = new Date();

    // 1. Cron
    const secretCron = env("EMAILS_CRON_SECRET");
    if (secretCron && egal(req.headers.get("x-cron-secret") ?? "", secretCron)) {
      const utilisateurs = await listerUtilisateurs(db);
      const profils = await chargerProfils(db, utilisateurs, maintenant);
      const resultats = await traiter(db, profils, maintenant, Boolean(corps.simulation));
      return json({ ok: true, mode: MODE, simulation: Boolean(corps.simulation), comptes: profils.length, resultats });
    }

    // 2. Appel ponctuel d'un utilisateur connecté
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ ok: false, erreur: "Non autorisé." }, 401);
    const { data: auth, error: authErr } = await db.auth.getUser(jwt);
    if (authErr || !auth.user) return json({ ok: false, erreur: "Non autorisé." }, 401);

    let cible = auth.user.id;
    let simulation = false;
    if (corps.userId || corps.simulation) {
      if (!(await estAdmin(db, auth.user.id))) return json({ ok: false, erreur: "Réservé aux administrateurs." }, 403);
      if (corps.userId && /^[0-9a-f-]{36}$/i.test(corps.userId)) cible = corps.userId;
      simulation = Boolean(corps.simulation);
    }
    const utilisateurs = await listerUtilisateurs(db, cible);
    const profils = await chargerProfils(db, utilisateurs, maintenant);
    const resultats = await traiter(db, profils, maintenant, simulation);
    // Un utilisateur ordinaire ne voit que des types et statuts, jamais d'adresse.
    return json({ ok: true, mode: MODE, simulation, resultats: resultats.map(({ type, statut }) => ({ type, statut })) });
  } catch (e) {
    console.error("[emails-cycle-vie]", e);
    return json({ ok: false, erreur: (e as Error).message ?? "Erreur inconnue." }, 500);
  }
});

// Liste exportée pour la documentation (évite un import inutilisé).
export const TYPES_GERES = TYPES_EMAIL;
