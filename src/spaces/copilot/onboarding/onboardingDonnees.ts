// src/spaces/copilot/onboarding/onboardingDonnees.ts
// =============================================================================
// PREMIER CONTACT GUIDÉ — lecture / écriture des données RÉELLES du compte.
//
// Sources (toutes protégées par RLS « chacun les siennes ») :
//   · copilot_conversations          → au moins une analyse lancée avec Mimmo
//   · free_quick_analysis_usage      → analyses rapides consommées
//   · user_events (module_open, report_download) → module exploré, export PDF
//   · user_onboarding                → profil déclaré, encart/checklist fermés,
//                                      étapes constatées (migration 20261022_onboarding_premier_contact.sql)
//
// Tant que la migration n'est pas appliquée, la table user_onboarding manque :
// l'état « fermé » et le profil se replient sur le stockage local (par compte).
// =============================================================================

import { supabase } from '@/lib/supabaseClient';
import { userStorage } from '@/lib/storage/userScopedStorage';
import type { EtatOnboarding, IdEtape, ProfilDeclare } from './onboardingRegles';

const CLE_LOCALE = 'mzia.onboarding.v1';
const CLE_EMAIL_CONNEXION = 'mzia.onboarding.emailConnexion';

interface LigneOnboarding {
  profil: ProfilDeclare | null;
  encart_ferme_le: string | null;
  checklist_fermee_le: string | null;
  termine_le: string | null;
  etapes: Partial<Record<IdEtape, string>>;
}

const VIDE: LigneOnboarding = {
  profil: null,
  encart_ferme_le: null,
  checklist_fermee_le: null,
  termine_le: null,
  etapes: {},
};

export interface DonneesOnboarding {
  etat: EtatOnboarding;
  profil: ProfilDeclare | null;
  /** false = migration non appliquée, repli local. */
  serveur: boolean;
}

function tableAbsente(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const m = (error.message ?? '').toLowerCase();
  return error.code === '42P01' || error.code === 'PGRST205' || m.includes('does not exist') || m.includes('could not find the table');
}

function lireLocal(): LigneOnboarding {
  try {
    const brut = userStorage.getItem(CLE_LOCALE);
    return brut ? { ...VIDE, ...(JSON.parse(brut) as Partial<LigneOnboarding>) } : { ...VIDE };
  } catch {
    return { ...VIDE };
  }
}

function ecrireLocal(l: LigneOnboarding): void {
  userStorage.setItem(CLE_LOCALE, JSON.stringify(l));
}

let derniereLigne: LigneOnboarding = { ...VIDE };
let ligneChargee = false;
let ligneUid: string | null = null;
let serveurDisponible = true;

/** Relit la ligne avant toute écriture (évite d'écraser des champs non chargés). */
async function assurerLigne(): Promise<void> {
  const u = await uid();
  if (!u) return;
  if (ligneChargee && ligneUid === u.id) return;
  ligneUid = u.id;
  const { data, error } = await supabase
    .from('user_onboarding')
    .select('profil, encart_ferme_le, checklist_fermee_le, termine_le, etapes')
    .maybeSingle();
  if (tableAbsente(error)) serveurDisponible = false;
  derniereLigne = data
    ? { ...VIDE, ...(data as Partial<LigneOnboarding>), etapes: (data as LigneOnboarding).etapes ?? {} }
    : lireLocal();
  ligneChargee = !error || tableAbsente(error);
}

async function uid(): Promise<{ id: string; creeLe: string | null } | null> {
  const { data } = await supabase.auth.getUser();
  return data.user ? { id: data.user.id, creeLe: data.user.created_at ?? null } : null;
}

export async function chargerOnboarding(): Promise<DonneesOnboarding | null> {
  const u = await uid();
  if (!u) return null;

  const [conv, quota, modules, exports, ligne] = await Promise.all([
    supabase.from('copilot_conversations').select('id', { count: 'exact', head: true }),
    supabase.from('free_quick_analysis_usage').select('nb'),
    supabase.from('user_events').select('id').eq('event_type', 'module_open').limit(1),
    supabase.from('user_events').select('id').eq('event_type', 'report_download').limit(1),
    supabase
      .from('user_onboarding')
      .select('profil, encart_ferme_le, checklist_fermee_le, termine_le, etapes')
      .maybeSingle(),
  ]);

  let l: LigneOnboarding;
  if (tableAbsente(ligne.error)) {
    serveurDisponible = false;
    l = lireLocal();
  } else {
    serveurDisponible = !ligne.error;
    l = ligne.data ? { ...VIDE, ...(ligne.data as Partial<LigneOnboarding>), etapes: (ligne.data as LigneOnboarding).etapes ?? {} } : lireLocal();
  }
  derniereLigne = l;
  ligneUid = u.id;
  ligneChargee = !ligne.error || tableAbsente(ligne.error);

  const analysesRapides = ((quota.data ?? []) as { nb: number }[]).reduce((s, r) => s + (r.nb ?? 0), 0);
  const anciennete = u.creeLe ? (Date.now() - Date.parse(u.creeLe)) / 86_400_000 : null;

  const etat: EtatOnboarding = {
    // Lecture impossible (réseau) : on ne présume pas un nouveau compte.
    nbConversations: conv.error ? 1 : conv.count ?? 0,
    analysesRapides,
    exportPdf: Boolean(l.etapes.export_pdf) || (exports.data?.length ?? 0) > 0,
    moduleOuvert: Boolean(l.etapes.module) || (modules.data?.length ?? 0) > 0,
    encartFerme: Boolean(l.encart_ferme_le || l.termine_le),
    checklistFermee: Boolean(l.checklist_fermee_le || l.termine_le),
    ancienneteJours: anciennete !== null && Number.isFinite(anciennete) ? anciennete : null,
  };
  return { etat, profil: l.profil, serveur: serveurDisponible };
}

/** Met à jour la ligne de l'utilisateur (serveur, sinon local). Ne lève jamais. */
export async function enregistrerOnboarding(patch: Partial<LigneOnboarding>): Promise<void> {
  try { await assurerLigne(); } catch { /* repli sur l'état connu */ }
  const suivante: LigneOnboarding = {
    ...derniereLigne,
    ...patch,
    etapes: { ...derniereLigne.etapes, ...(patch.etapes ?? {}) },
  };
  if (suivante.encart_ferme_le && suivante.checklist_fermee_le && !suivante.termine_le) {
    suivante.termine_le = new Date().toISOString();
  }
  derniereLigne = suivante;
  ecrireLocal(suivante);
  if (!serveurDisponible) return;
  try {
    const u = await uid();
    if (!u) return;
    const { error } = await supabase
      .from('user_onboarding')
      .upsert({ user_id: u.id, ...suivante, maj_le: new Date().toISOString() }, { onConflict: 'user_id' });
    if (tableAbsente(error)) serveurDisponible = false;
  } catch {
    /* le repli local suffit */
  }
}

export async function marquerEtape(etape: IdEtape): Promise<void> {
  try { await assurerLigne(); } catch { /* idem */ }
  if (derniereLigne.etapes[etape]) return;
  await enregistrerOnboarding({ etapes: { [etape]: new Date().toISOString() } });
}

/**
 * Appel ponctuel de la fonction e-mails (bienvenue juste après la confirmation),
 * une seule fois par navigateur et par compte. Sans effet si la fonction n'est
 * pas déployée ; idempotente côté serveur.
 */
export function signalerConnexionEmails(): void {
  try {
    if (userStorage.getItem(CLE_EMAIL_CONNEXION)) return;
    userStorage.setItem(CLE_EMAIL_CONNEXION, new Date().toISOString());
    void supabase.functions.invoke('emails-cycle-vie', { body: { evenement: 'connexion' } }).catch(() => undefined);
  } catch {
    /* silencieux */
  }
}
