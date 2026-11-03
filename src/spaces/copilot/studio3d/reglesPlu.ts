// src/spaces/copilot/studio3d/reglesPlu.ts
//
// RÈGLES PLU CHIFFRÉES DE LA CONVERSATION → règles du volume d'étude
// (logique PURE, testée ; aucune requête).
//
// Formats réels lus (supabase/functions/copilot-chat) :
//   - get_parcel_plu, règlement importé (plu-parser, summarizePluContext) :
//     data.zone_code + data.regles.{hauteur_max_m, hauteur_faitage_m,
//     emprise_sol_max_ratio, recul_voirie_m, recul_limites_m, pleine_terre_ratio_min, cos_max}
//   - get_parcel_plu, fonction PLU dédiée (summarizePlu) : clés plates
//     hauteur_max(_m), emprise_max | ces | coefficient_emprise_sol, recul_voie, recul_limites_separatives
//   - get_parcel_plu, règlement LU au Géoportail (plu-reglement-v1, donneesReglementLu) :
//     data.niveau_de_detail = 'reglement_lu', zone / zone_lue, document, et le TEXTE
//     reglement_extrait (pages « [Page N] ») : les règles sont repérées dans le texte
//     par des motifs prudents (valeur, article, page) ; plusieurs valeurs → la plus contraignante.
//   - get_parcel_plu 'zonage_seul' / 'a_preciser' : aucune règle chiffrée (signalé).
//   - Conception (agent) : enregistrer_regles_conception.input.regles[]
//     {cle, valeur, statut, source, article} (clés hauteur_max_m, niveaux_max,
//     emprise_sol_max_pct, recul_voie_m, recul_limites_m, recul_limites_formule,
//     pleine_terre_min_pct), rattachées à l'IDU de recuperer_parcelle du même message.
//
// Rattachement : un lot de règles ne s'applique à la parcelle affichée que s'il
// porte sur son IDU, ou sur sa zone (même commune si elle est connue ; un
// secteur « UBb » accepte les règles de « UB »). Les autres sont listées « ignorées ».

import { normaliserIdu } from './missionPreparation3D.ts';
import type { CleReglePlu, ReglePlu, ReglesPluVolume } from './volumeParcelle.ts';

export interface AppelOutil { name: string; status: string; input?: unknown; output?: unknown }
export interface MessageRegles { role: 'user' | 'assistant'; toolCalls?: AppelOutil[] }

export interface LotRegles {
  regles: ReglePlu[];
  zone: string | null;
  idu: string | null;
  insee: string | null;
  /** Libellé de la source (document, outil). */
  origine: string;
  niveau: 'importe' | 'reglement_lu' | 'zonage_seul' | 'a_preciser' | 'conception';
  /** Notions cherchées mais non trouvées / non chiffrées. */
  manquantes: string[];
}

const enr = (v: unknown): Record<string, unknown> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const nb = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\s*\d+(?:[.,]\d+)?\s*$/.test(v) ? Number(v.replace(',', '.')) : null;
const txt = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.trim() : null;
const ratio = (v: unknown): number | null => { const n = nb(v); return n !== null && n > 0 && n <= 1 ? n : null; };
const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, "'");

export const normaliserZone = (z: unknown): string | null => typeof z === 'string' && z.trim() ? z.replace(/\s+/g, '') : null;

/** Même zone, ou secteur d'une zone (« UBb » ⊂ « UB ») ; comparaison sans tenir compte de la casse du code principal. */
export function memeZone(zoneParcelle: string, zoneRegles: string): boolean {
  const a = normaliserZone(zoneParcelle), b = normaliserZone(zoneRegles);
  if (!a || !b) return false;
  if (a.toUpperCase() === b.toUpperCase()) return true;
  return a.toUpperCase().startsWith(b.toUpperCase()) && /^[a-z0-9]+$/.test(a.slice(b.length));
}

// --- Lecture du texte d'un règlement -------------------------------------------------------------
const NUM = '(\\d{1,3}(?:[,.]\\d{1,2})?)';
const MAX = /(maxim|ne (?:peut|doit|peuvent|doivent) (?:pas )?(?:exceder|depasser)|n'excede|limitee?s? a|au plus|plafonn|ne pourra (?:pas )?exceder)/;
const valeurs = (phrase: string, unite: RegExp) => [...phrase.matchAll(new RegExp(`${NUM}\\s*${unite.source}`, 'g'))]
  .map(m => ({ v: Number(m[1].replace(',', '.')), i: m.index! }));

/**
 * Règles chiffrées repérées dans le texte d'un règlement (« [Page N] » suivis).
 * Prudence : phrases portant un mot de limite ; annexes, piscines et majorations écartées.
 */
export function extraireReglesDuTexte(texte: string, source: string): { regles: ReglePlu[]; manquantes: string[] } {
  const regles: ReglePlu[] = [];
  let page: number | null = null, article: string | null = null;
  const morceaux = texte.replace(/ /g, ' ').split(/(\[Page\s+\d+\])/i);
  const ajouter = (cle: CleReglePlu, valeur: number, extra: Partial<ReglePlu> = {}) => {
    const reference = [article ? `art. ${article}` : null, page !== null ? `p. ${page}` : null].filter(Boolean).join(', ') || null;
    regles.push({ cle, valeur, source, reference, statut: 'lue', ...extra });
  };
  for (const morceau of morceaux) {
    const p = /\[Page\s+(\d+)\]/i.exec(morceau);
    if (p) { page = Number(p[1]); continue; }
    const phrases = morceau.replace(/\s+/g, ' ').split(/(?<=[.;])\s+(?=[A-ZÀ-Ý0-9«(-])/);
    for (const brute of phrases) {
      const titres = [...brute.matchAll(/\barticle\s+([A-Z]{0,4}\s?-?\s?\d{1,2}(?:\.\d{1,2})?)\b/gi)];
      if (titres.length) article = titres[titres.length - 1][1].replace(/\s+/g, ' ').trim();
      const f = sansAccents(brute);
      if (/piscine|annexe|abri|garage|cloture|majoration|bonus|depassement autorise/.test(f)) continue;
      // Hauteur (égout / acrotère / faîtage) — pas les règles de prospect (hauteur ≤ distance).
      if (/hauteur/.test(f) && MAX.test(f) && !/(recul|retrait|distance|limites? separatives?|largeur de (?:la )?voie|prospect)/.test(f)) {
        for (const { v, i } of valeurs(f, /(?:m\b|metres?\b)/)) {
          if (v < 3 || v > 100) continue;
          // Qualificatif juste après la valeur (« 18 m au faîtage »), sinon le dernier cité avant.
          const apres = /^[^,;.]{0,25}?(faitage|egout|acrotere)/.exec(f.slice(i).replace(/^\S+\s*\S*/, ''));
          const avant = f.slice(Math.max(0, i - 70), i);
          const faitage = apres ? apres[1] === 'faitage'
            : avant.lastIndexOf('faitage') > Math.max(avant.lastIndexOf('egout'), avant.lastIndexOf('acrotere'));
          ajouter(faitage ? 'hauteur_faitage_m' : 'hauteur_max_m', v);
        }
        for (const m of f.matchAll(/\br\s*\+\s*(\d{1,2})\b/g)) ajouter('niveaux_max', Number(m[1]) + 1);
      } else if (MAX.test(f) && /\br\s*\+\s*\d{1,2}\b/.test(f) && /(niveau|hauteur|construction|batiment)/.test(f)) {
        for (const m of f.matchAll(/\br\s*\+\s*(\d{1,2})\b/g)) ajouter('niveaux_max', Number(m[1]) + 1);
      }
      if (/emprise au sol/.test(f) && MAX.test(f)) {
        for (const { v } of valeurs(f, /%/)) if (v > 0 && v <= 100) ajouter('emprise_max_ratio', v / 100);
      }
      if (/(pleine terre|espaces? verts?)/.test(f) && /(au moins|minimum|minimal|doit|doivent|represent)/.test(f)) {
        for (const { v } of valeurs(f, /%/)) if (v > 0 && v < 100) ajouter('pleine_terre_min_ratio', v / 100);
      }
      const recul = /(recul|retrait|distance|marge|implant)/.test(f);
      if (recul && /limites? separatives?/.test(f)) {
        const formule = /\bh\s*\/\s*([1-4])\b/.exec(f);
        if (formule) {
          const min = new RegExp(`(?:minimum|min\\.?|sans (?:pouvoir )?etre inferieure? a|avec un minimum de|au moins egale? a|≥|>=)\\s*(?:de\\s*)?${NUM}\\s*m`).exec(f.slice(formule.index));
          ajouter('recul_limites_formule', Number(formule[1]), { minimumM: min ? Number(min[1].replace(',', '.')) : null });
        } else {
          for (const { v } of valeurs(f, /(?:m\b|metres?\b)/)) if (v >= 1 && v <= 30) ajouter('recul_limites_m', v);
        }
      } else if (recul && /(voies?\b|alignement|emprises? publiques?)/.test(f) && !/\bh\s*\/\s*\d/.test(f)) {
        for (const { v } of valeurs(f, /(?:m\b|metres?\b)/)) if (v >= 1 && v <= 30) ajouter('recul_voie_m', v);
      }
      if (/(epaisseur|profondeur) (?:maximale|max\.?|du batiment|des constructions)/.test(f) && MAX.test(f)) {
        for (const { v } of valeurs(f, /(?:m\b|metres?\b)/)) if (v >= 6 && v <= 60) ajouter('epaisseur_max_m', v);
      }
    }
  }
  const trouve = (...c: CleReglePlu[]) => regles.some(r => c.includes(r.cle));
  const manquantes = [
    trouve('hauteur_max_m', 'hauteur_faitage_m', 'niveaux_max') ? null : 'Hauteur maximale : non trouvée dans les pages lues',
    trouve('emprise_max_ratio') ? null : 'Emprise au sol : non trouvée dans les pages lues',
    trouve('recul_voie_m') ? null : 'Recul à la voie : non trouvé dans les pages lues',
    trouve('recul_limites_m', 'recul_limites_formule') ? null : 'Recul aux limites séparatives : non trouvé dans les pages lues',
    trouve('pleine_terre_min_ratio') ? null : 'Pleine terre / espaces verts : non trouvés dans les pages lues',
  ].filter((v): v is string => Boolean(v));
  return { regles, manquantes };
}

/** « H/2 min 4 m » (texte d'une règle de conception) → formule. */
function formuleDepuisTexte(v: string): { diviseur: number; minimumM: number | null } | null {
  const f = sansAccents(v);
  const m = /\bh\s*\/\s*([1-4])\b/.exec(f);
  if (!m) return null;
  const min = new RegExp(`(?:min(?:imum)?\\.?|≥|>=)\\s*(?:de\\s*)?${NUM}\\s*m`).exec(f);
  return { diviseur: Number(m[1]), minimumM: min ? Number(min[1].replace(',', '.')) : null };
}

const CLES_CONCEPTION: Record<string, CleReglePlu> = {
  hauteur_max_m: 'hauteur_max_m', niveaux_max: 'niveaux_max', emprise_sol_max_pct: 'emprise_max_ratio',
  recul_voie_m: 'recul_voie_m', recul_limites_m: 'recul_limites_m', recul_limites_formule: 'recul_limites_formule',
  pleine_terre_min_pct: 'pleine_terre_min_ratio',
};

/** Règles au format conception (RegleConception) → règles du volume. */
function reglesConception(liste: unknown[], origine: string): ReglePlu[] {
  const out: ReglePlu[] = [];
  for (const e of liste) {
    const r = enr(e); const cle = r ? CLES_CONCEPTION[String(r.cle)] : undefined;
    if (!r || !cle || r.statut === 'manquant') continue;
    const statut = r.statut === 'confirme' ? 'lue' : 'estimee';
    const base = { source: txt(r.source) ?? origine, reference: txt(r.article), statut } as const;
    if (cle === 'recul_limites_formule') {
      const f = typeof r.valeur === 'string' ? formuleDepuisTexte(r.valeur) : null;
      if (f) out.push({ cle, valeur: f.diviseur, minimumM: f.minimumM, ...base });
      continue;
    }
    const v = nb(r.valeur);
    if (v === null) continue;
    out.push({ cle, valeur: cle === 'emprise_max_ratio' || cle === 'pleine_terre_min_ratio' ? v / 100 : v, ...base });
  }
  return out;
}

/** Lots de règles PLU de la conversation, dans l'ordre chronologique. */
export function lotsReglesDesMessages(messages: readonly MessageRegles[]): LotRegles[] {
  const lots: LotRegles[] = [];
  for (const m of messages) {
    const appels = m.toolCalls ?? [];
    const iduConception = appels.filter(a => a.name === 'recuperer_parcelle' && a.status === 'success')
      .map(a => normaliserIdu(enr(a.input)?.idu)).find(Boolean) ?? null;
    for (const a of appels) {
      if (a.status !== 'success') continue;
      const entree = enr(a.input) ?? {};
      const sortie = enr(a.output);
      const d = enr(sortie?.data) ?? sortie ?? {};
      if (a.name === 'get_parcel_plu') {
        const idu = normaliserIdu(entree.parcel_id) ?? normaliserIdu(entree.cadastral_ref);
        const insee = idu ? idu.slice(0, 5) : null;
        const sourceOutil = txt(sortie?.source) ?? 'get_parcel_plu';
        if (d.niveau_de_detail === 'reglement_lu' || typeof d.reglement_extrait === 'string') {
          const doc = enr(d.document) ?? {};
          const origine = ['Règlement', txt(doc.type) ?? 'PLU', txt(doc.territoire), txt(doc.date_approbation) ? `approuvé le ${txt(doc.date_approbation)}` : null].filter(Boolean).join(' ');
          const { regles, manquantes } = extraireReglesDuTexte(String(d.reglement_extrait ?? ''), origine);
          lots.push({ regles, manquantes, zone: normaliserZone(d.zone_lue) ?? normaliserZone(d.zone) ?? normaliserZone(entree.zone_code), idu, insee, origine, niveau: 'reglement_lu' });
          continue;
        }
        if (d.niveau_de_detail === 'zonage_seul' || d.niveau_de_detail === 'a_preciser') {
          lots.push({ regles: [], manquantes: [d.niveau_de_detail === 'zonage_seul' ? 'Zonage seul : aucune règle chiffrée lue (règlement non importé ni lu)' : 'Règlement trouvé mais à préciser avant lecture : aucune règle chiffrée lue'],
            zone: normaliserZone(d.zone_code) ?? normaliserZone(d.zone) ?? normaliserZone(enr(d.zone_principale)?.libelle), idu, insee, origine: sourceOutil, niveau: d.niveau_de_detail });
          continue;
        }
        const r = enr(d.regles) ?? {};
        const regles: ReglePlu[] = [];
        const poser = (cle: CleReglePlu, v: number | null) => { if (v !== null) regles.push({ cle, valeur: v, source: sourceOutil, reference: null, statut: 'importee' }); };
        poser('hauteur_max_m', nb(r.hauteur_max_m) ?? nb(d.hauteur_max_m) ?? nb(d.hauteur_max));
        poser('hauteur_faitage_m', nb(r.hauteur_faitage_m));
        poser('emprise_max_ratio', ratio(r.emprise_sol_max_ratio) ?? ratio(d.emprise_max) ?? ratio(d.ces) ?? ratio(d.coefficient_emprise_sol));
        poser('recul_voie_m', nb(r.recul_voirie_m) ?? nb(d.recul_voie));
        poser('recul_limites_m', nb(r.recul_limites_m) ?? nb(d.recul_limites_separatives));
        poser('pleine_terre_min_ratio', ratio(r.pleine_terre_ratio_min));
        const manquantes: string[] = [];
        if (nb(r.cos_max) !== null) manquantes.push('COS : non utilisé pour le volume');
        if (nb(r.emprise_sol_max_ratio) !== null && ratio(r.emprise_sol_max_ratio) === null) manquantes.push('Emprise au sol : valeur au format ambigu, non appliquée');
        if (!regles.length && !manquantes.length) manquantes.push('Règles chiffrées absentes de la réponse PLU');
        lots.push({ regles, manquantes, zone: normaliserZone(d.zone_code) ?? normaliserZone(d.zone), idu, insee, origine: sourceOutil, niveau: 'importe' });
        continue;
      }
      if (a.name === 'enregistrer_regles_conception' && Array.isArray(entree.regles)) {
        lots.push({ regles: reglesConception(entree.regles, 'Règles de conception'), manquantes: [], zone: null, idu: iduConception, insee: iduConception?.slice(0, 5) ?? null, origine: 'Règles de conception', niveau: 'conception' });
        continue;
      }
      if (a.name === 'lire_regles_plu_importees' && Array.isArray(d.regles)) {
        lots.push({ regles: reglesConception(d.regles, 'Règlement importé'), manquantes: [], zone: normaliserZone(entree.zone_code), idu: null, insee: txt(entree.code_insee), origine: 'Règlement importé', niveau: 'conception' });
      }
    }
  }
  return lots;
}

/**
 * Règles applicables à la parcelle affichée. `uneSeuleParcelle` : la conversation ne
 * porte que sur cette parcelle (un lot sans zone ni IDU lui est alors rattaché, en le disant).
 */
export function reglesPourParcelle(lots: readonly LotRegles[], cible: { idu: string | null; zone: string | null }, uneSeuleParcelle: boolean): ReglesPluVolume {
  const regles: ReglePlu[] = [], nonAppliquees: string[] = [];
  let lu = false;
  const insee = cible.idu?.slice(0, 5) ?? null;
  for (const lot of lots) {
    const zoneOk = Boolean(cible.zone && lot.zone && memeZone(cible.zone, lot.zone) && (!lot.insee || !insee || lot.insee === insee));
    let applicable = false, note: string | null = null;
    if (lot.idu && cible.idu && lot.idu === cible.idu) applicable = true;
    else if (zoneOk) applicable = true;
    else if (lot.idu && cible.idu && lot.idu !== cible.idu) note = `Règles ${lot.zone ? `de la zone ${lot.zone} ` : ''}lues pour la parcelle ${lot.idu} : ignorées (${lot.zone && cible.zone ? `zone ${cible.zone} ici` : 'autre parcelle'}).`;
    else if (lot.zone && cible.zone) note = `Règles de la zone ${lot.zone} ignorées : la parcelle affichée est en zone ${cible.zone}.`;
    else if (uneSeuleParcelle) { applicable = true; note = lot.regles.length ? `Règles « ${lot.origine} » rattachées à la seule parcelle de la conversation (zone non vérifiée).` : null; }
    else note = `Règles « ${lot.origine} »${lot.zone ? ` (zone ${lot.zone})` : ''} non appliquées : leur parcelle ou la zone de la parcelle affichée est inconnue.`;
    if (note && (lot.regles.length || !applicable)) nonAppliquees.push(note);
    if (!applicable) continue;
    if (lot.niveau === 'reglement_lu') lu = true;
    regles.push(...lot.regles);
    nonAppliquees.push(...lot.manquantes);
  }
  // Une notion trouvée dans un lot applicable n'est plus « non trouvée » ailleurs.
  const trouvees = new Set(regles.map(r => r.cle));
  const filtre = (l: string) => !(
    (/^Hauteur maximale/.test(l) && (trouvees.has('hauteur_max_m') || trouvees.has('hauteur_faitage_m') || trouvees.has('niveaux_max')))
    || (/^Emprise au sol : non trouvée/.test(l) && trouvees.has('emprise_max_ratio'))
    || (/^Recul à la voie/.test(l) && trouvees.has('recul_voie_m'))
    || (/^Recul aux limites/.test(l) && (trouvees.has('recul_limites_m') || trouvees.has('recul_limites_formule')))
    || (/^Pleine terre/.test(l) && trouvees.has('pleine_terre_min_ratio'))
    || (/^Zonage seul|^Règlement trouvé mais|^Règles chiffrées absentes/.test(l) && regles.length > 0));
  return {
    source: regles.length ? 'plu-chiffre' : lu ? 'reglement-texte' : 'aucune',
    regles,
    nonAppliquees: [...new Set(nonAppliquees.filter(filtre))],
  };
}
