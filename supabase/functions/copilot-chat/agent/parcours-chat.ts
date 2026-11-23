// supabase/functions/copilot-chat/agent/parcours-chat.ts
// =============================================================================
// VIS-17 (20/11/2026) — bloc système « PARCOURS — FAIT FOI » relu à CHAQUE message. Module PUR (testé par Deno).
//
// Le serveur relit lui-même en base ce qui fait foi : mission de conception de la conversation (agent_missions),
// dernière 3D préparée (studio_preparations), rendus (studio_jobs) et aperçu validé (bloc ```mimmoza-parcours``` d'un
// message de l'utilisateur). Ce que seul l'écran connaît (brief projet de l'étude dans le navigateur : vues, lumière,
// saison, gamme ; réglages du film / de la visite ; type choisi) arrive dans `context.parcours`, relu défensivement
// (lireInstantaneParcours). Le calcul des statuts est celui de l'écran (src/lib/studio/parcours.ts) : mêmes étapes.
// =============================================================================
import {
  apercuValideDesMessages, blocParcoursSysteme, calculerParcours, lireInstantaneParcours, sourcesDeLInstantane, programmeDesCriteres, terrainDesCriteres, travailParcours,
  typeParcoursDesMessages, typeParcoursDuTexte, type Parcours, type SourcesParcours, type TravailParcours,
} from '../../../../src/lib/studio/parcours.ts';

// VIS-21 : mission de conception qui fait foi (une conception terminée n'est pas masquée par un devis postérieur).
export { missionConceptionDeReference } from '../../../../src/lib/studio/parcours.ts';

export interface PreparationLue { idu: string | null; resume: unknown }
export interface MissionLue { id?: string | null; type: string; statut: string; criteres?: unknown; cree_le?: string | null }

export interface EntreeParcoursServeur {
  instantane: unknown;
  /** Dernière mission de conception de la conversation (statut réel), s'il y en a une. */
  mission: MissionLue | null;
  /** Dernière 3D préparée de la conversation. */
  preparation: PreparationLue | null;
  /** Lignes studio_jobs de la conversation. */
  travaux: readonly unknown[];
  /** Messages de l'utilisateur déjà en base (du plus ancien au plus récent). */
  textesUtilisateur: readonly string[];
  /** Message reçu (pas encore en base). */
  messageCourant: string;
  /** VIS-18b — ligne studio_temoins de la conversation (colonne `temoin`), s'il y en a une (table absente : null). */
  temoin?: unknown;
}

/**
 * VIS-18b — témoin personnalisé de la base (studio_temoins.temoin, écrit par le site après validation complète par
 * pontParcoursStudio.lireTemoin, VIS-18a) → étape « Intérieurs » ; null si rien de personnalisé. Lecture minimale ici
 * (format, version, drapeau, résumé borné) : la ligne n'est écrite qu'après la validation complète, et le module du
 * pont n'est pas importé dans la fonction (ses gardes de types ne passent pas `deno check`).
 */
export const FORMAT_TEMOIN_LU = 'mimmozia-temoin-personnalise';
export function temoinDeLaBase(ligne: unknown): { fait: boolean; resume: string | null } | null {
  const brut = estObj(ligne) && 'temoin' in ligne ? ligne.temoin : ligne;
  if (!estObj(brut) || brut.format !== FORMAT_TEMOIN_LU || brut.version !== 1 || brut.personnalise !== true) return null;
  const resume = typeof brut.resume === 'string' && brut.resume.trim() ? brut.resume.replace(/\s+/g, ' ').trim().slice(0, 300) : null;
  return { fait: true, resume };
}

const estObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nf = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 0 });

/** Résumé de la 3D préparée (studio_preparations.resume), lu champ par champ, jamais deviné. */
export function resumePreparation(p: PreparationLue | null): { terrain: string | null; volume: string | null } {
  if (!p) return { terrain: null, volume: null };
  const r = estObj(p.resume) ? p.resume : {};
  const num = (k: string) => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? r[k] as number : null);
  const bat = num('batiments');
  const gabarit = typeof r.gabarit === 'string' ? r.gabarit : null;
  const logements = num('logements_places');
  const sdp = num('sdp_estimee_m2');
  const volume = [
    bat !== null && gabarit ? `${String(bat)} bâtiment${bat > 1 ? 's' : ''} en ${gabarit}` : null,
    sdp !== null ? `≈ ${nf(sdp)} m² de surface de plancher (estimée)` : null,
    logements !== null ? `${nf(logements)} logements placés` : null,
  ].filter(Boolean).join(' · ');
  const assiette = typeof r.assiette === 'string' && r.assiette.trim() ? r.assiette.trim() : null;
  return { terrain: assiette ?? p.idu, volume: volume || null };
}

/** VIS-19 — derniers messages de l’utilisateur relus (type de parcours demandé), au lieu de 60. */
export const MESSAGES_RECENTS_PARCOURS = 20;
/** VIS-19 — messages contenant un bloc relu par le parcours (aperçu validé, habillage) : au plus ce nombre. */
export const MESSAGES_BLOCS_PARCOURS = 20;
/** VIS-19 — blocs cherchés (ilike sur `content->0->>text`) : ```mimmoza-parcours (aperçu validé), ```mimmoza-brief (habillage). */
export const MOTIFS_BLOCS_PARCOURS = ['%```mimmoza-parcours%', '%```mimmoza-brief%'] as const;

export interface LigneMessageLue { id?: unknown; created_at?: unknown; texte: string }

/**
 * VIS-19 — PURE : textes de l'utilisateur pour le parcours, depuis les derniers messages ET les messages à bloc
 * (deux lectures courtes au lieu de 60 messages complets) : sans doublon (id), du plus ancien au plus récent.
 */
export function fusionnerTextesUtilisateur(...listes: ReadonlyArray<readonly LigneMessageLue[]>): string[] {
  const vus = new Set<string>();
  const lignes: LigneMessageLue[] = [];
  for (const l of listes) {
    for (const m of l) {
      const id = typeof m.id === 'string' || typeof m.id === 'number' ? String(m.id) : null;
      if (id !== null) { if (vus.has(id)) continue; vus.add(id); }
      lignes.push(m);
    }
  }
  const t = (m: LigneMessageLue) => { const v = typeof m.created_at === 'string' ? Date.parse(m.created_at) : Number.NaN; return Number.isFinite(v) ? v : 0; };
  return lignes.map((m, i) => ({ m, i })).sort((a, b) => t(a.m) - t(b.m) || a.i - b.i).map(({ m }) => m.texte);
}

/** Sources du parcours côté serveur : base (fait foi) + instantané de l'écran. */
export function sourcesServeur(e: EntreeParcoursServeur): SourcesParcours {
  const instantane = lireInstantaneParcours(e.instantane);
  const textes = [...e.textesUtilisateur, e.messageCourant];
  const type = instantane?.type ?? typeParcoursDuTexte(e.messageCourant) ?? typeParcoursDesMessages(e.textesUtilisateur);
  const s = sourcesDeLInstantane(instantane, type);
  const prep = resumePreparation(e.preparation);
  const habillageFil = textes.some((t) => /```mimmoza-brief/.test(t)) ? 'Habillage choisi dans la conversation.' : null;
  return {
    ...s,
    type,
    terrain: prep.terrain ?? terrainDesCriteres(e.mission?.criteres),
    conception: e.mission && e.mission.type === 'conception' ? { statut: e.mission.statut, resume: programmeDesCriteres(e.mission.criteres) ?? prep.volume, missionId: e.mission.id ?? null } : null,
    volume: e.preparation ? { pret: true, resume: prep.volume ?? '3D préparée par Mimmo.' } : { pret: false, resume: null },
    habillage: { resume: s.habillage.resume ?? habillageFil, attenduParMimmo: false },
    travaux: e.travaux.map(travailParcours).filter((t): t is TravailParcours => t !== null),
    apercuValide: apercuValideDesMessages(textes),
    temoinStudio: temoinDeLaBase(e.temoin ?? null),
  };
}

/** Le bloc est-il utile à ce tour ? (projet en 3D, conception, rendus, ou demande d'image / film / visite) */
export function parcoursPertinent(e: EntreeParcoursServeur): boolean {
  return !!e.preparation || e.mission?.type === 'conception' || e.travaux.length > 0
    || typeParcoursDuTexte(e.messageCourant) !== null || lireInstantaneParcours(e.instantane)?.type != null;
}

/** Bloc « PARCOURS — FAIT FOI » (vide quand le parcours n'est pas en jeu). */
export function blocParcoursServeur(e: EntreeParcoursServeur): { bloc: string; parcours: Parcours | null } {
  if (!parcoursPertinent(e)) return { bloc: '', parcours: null };
  const parcours = calculerParcours(sourcesServeur(e));
  return { bloc: blocParcoursSysteme(parcours), parcours };
}
