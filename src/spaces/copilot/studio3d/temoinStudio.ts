// src/spaces/copilot/studio3d/temoinStudio.ts
// =============================================================================
// VIS-18a (20/11/2026) — LOGEMENT TÉMOIN PERSONNALISÉ DANS LE STUDIO, CÔTÉ SITE.
//
// Le Studio envoie `temoin.etat` (protocole mimmoza-parcours-studio v1, pontParcoursStudio.ts) à chaque changement de
// l'étape Aménagement → Intérieur. Le site :
//   1. le valide (`lireTemoin` : format, version, bornes ; résumé et empreinte recalculés) ;
//   2. le garde dans le navigateur, SCOPÉ utilisateur + conversation (`mimmoza.temoin.<user>.<conversation>`) —
//      lecture immédiate par le parcours, même sans base ;
//   3. l'écrit dans `studio_temoins` (RLS propriétaire) — lu par le worker de rendu pour les vues intérieures ;
//      table absente (migration non appliquée) : rien ne casse, le local suffit au parcours ;
//   4. émet `mimmoza:temoin-studio` ({ conversationId }) pour que le parcours se recalcule.
// `lireTemoinPersonnalise` est PURE : c'est elle que le parcours appelle (voir le journal VIS-18a, ligne à ajouter).
// =============================================================================
import { lireTemoin, type TemoinPersonnalise } from '../../promoteur/shared/echangeStudio/pontParcoursStudio.ts';

export const EVENEMENT_TEMOIN_STUDIO = 'mimmoza:temoin-studio';
export const TABLE_TEMOINS = 'studio_temoins';

export interface EtatTemoinParcours {
  /** Vrai : un logement témoin a été personnalisé dans le Studio pour cette conversation. */
  fait: boolean;
  /** Une ligne : « T3 A204 · séjour scandinave · parquet · 18 meubles » ; null si rien. */
  resume: string | null;
  temoin: TemoinPersonnalise | null;
  source: 'base' | 'local' | null;
}

const RIEN: EtatTemoinParcours = { fait: false, resume: null, temoin: null, source: null };

/**
 * PURE — état de l'étape « Intérieurs » vu du Studio, depuis la ligne `studio_temoins` (colonne `temoin`, ou la ligne
 * entière) et/ou la copie locale. La plus récente (`majLe`) des deux lisibles l'emporte ; à égalité la base.
 * Un témoin non personnalisé (logement seulement ouvert) ne compte pas comme « fait ».
 */
export function lireTemoinPersonnalise(sources: { ligneBase?: unknown; local?: unknown } | null | undefined): EtatTemoinParcours {
  if (!sources) return RIEN;
  const brutBase = sources.ligneBase && typeof sources.ligneBase === 'object' && 'temoin' in (sources.ligneBase as object)
    ? (sources.ligneBase as { temoin: unknown }).temoin : sources.ligneBase;
  const base = lireTemoin(brutBase);
  const local = lireTemoin(sources.local);
  const t = base && local ? (Date.parse(local.majLe) > Date.parse(base.majLe) ? local : base) : base ?? local;
  if (!t || !t.personnalise) return RIEN;
  return { fait: true, resume: t.resume, temoin: t, source: t === base ? 'base' : 'local' };
}

/* ─── Copie locale (navigateur), scopée utilisateur + conversation ─── */

export interface StockageCle { getItem(k: string): string | null; setItem(k: string, v: string): void }

const RE_SUR = /^[A-Za-z0-9_-]{1,200}$/;
export function cleTemoinLocal(userId: string, conversationId: string): string | null {
  return RE_SUR.test(userId) && RE_SUR.test(conversationId) ? `mimmoza.temoin.${userId}.${conversationId}` : null;
}

function stockageParDefaut(): StockageCle | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

export function lireTemoinLocal(userId: string, conversationId: string, stockage: StockageCle | null = stockageParDefaut()): unknown {
  const k = cleTemoinLocal(userId, conversationId);
  if (!k || !stockage) return null;
  try { return JSON.parse(stockage.getItem(k) ?? 'null'); } catch { return null; }
}

export function memoriserTemoinLocal(userId: string, conversationId: string, temoin: TemoinPersonnalise | null, stockage: StockageCle | null = stockageParDefaut()): boolean {
  const k = cleTemoinLocal(userId, conversationId);
  if (!k || !stockage) return false;
  try { stockage.setItem(k, JSON.stringify(temoin)); return true; } catch { return false; }
}

/* ─── Base (studio_temoins, RLS propriétaire) ─── */

/** Sous-ensemble du client Supabase utilisé (injectable en test). */
export interface ClientTemoins {
  from(table: string): {
    upsert(ligne: Record<string, unknown>, o: { onConflict: string }): PromiseLike<{ error: { message: string } | null }>;
    select(colonnes: string): { eq(col: string, v: string): { maybeSingle(): PromiseLike<{ data: unknown; error: { message: string } | null }> } };
  };
}

export async function enregistrerTemoinBase(client: ClientTemoins, conversationId: string, projetId: string | null, temoin: TemoinPersonnalise): Promise<{ ok: boolean; erreur: string | null }> {
  try {
    const { error } = await client.from(TABLE_TEMOINS).upsert({
      conversation_id: conversationId, projet_id: projetId, temoin, resume: temoin.resume.slice(0, 300), empreinte: temoin.empreinte,
    }, { onConflict: 'user_id,conversation_id' });
    return error ? { ok: false, erreur: error.message } : { ok: true, erreur: null };
  } catch (e) {
    return { ok: false, erreur: e instanceof Error ? e.message : String(e) };
  }
}

export async function chargerTemoinBase(client: ClientTemoins, conversationId: string): Promise<unknown> {
  try {
    const { data, error } = await client.from(TABLE_TEMOINS).select('temoin,maj_le').eq('conversation_id', conversationId).maybeSingle();
    return error ? null : data ?? null;
  } catch { return null; }
}

/** État complet (base + local) d'une conversation — pour le parcours (asynchrone, jamais bloquant). */
export async function etatTemoinConversation(client: ClientTemoins, userId: string, conversationId: string, stockage: StockageCle | null = stockageParDefaut()): Promise<EtatTemoinParcours> {
  const ligneBase = await chargerTemoinBase(client, conversationId);
  return lireTemoinPersonnalise({ ligneBase, local: lireTemoinLocal(userId, conversationId, stockage) });
}

/** Dernière empreinte écrite en base par conversation (une écriture échouée est retentée au prochain envoi). */
const ecritsEnBase = new Map<string, string>();

/**
 * Réception d'un `temoin.etat` validé : copie locale, écriture en base (si l'empreinte a changé), événement.
 * `temoin` null (le Studio n'a plus de personnalisation) : copie locale effacée, la base garde la dernière version.
 */
export async function recevoirTemoinStudio(
  client: ClientTemoins, userId: string, conversationId: string, projetId: string | null, temoin: TemoinPersonnalise | null,
  stockage: StockageCle | null = stockageParDefaut(),
): Promise<{ local: boolean; base: { ok: boolean; erreur: string | null } | null }> {
  const local = memoriserTemoinLocal(userId, conversationId, temoin, stockage);
  const cle = `${userId}.${conversationId}`;
  const base = temoin && temoin.personnalise && ecritsEnBase.get(cle) !== temoin.empreinte
    ? await enregistrerTemoinBase(client, conversationId, projetId, temoin) : null;
  if (temoin && base?.ok) ecritsEnBase.set(cle, temoin.empreinte);
  try { window.dispatchEvent(new CustomEvent(EVENEMENT_TEMOIN_STUDIO, { detail: { conversationId } })); } catch { /* hors navigateur */ }
  return { local, base };
}
