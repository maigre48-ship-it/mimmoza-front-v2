// src/lib/studio/briefProjet.ts
// =============================================================================
// VIS-04 (18/11/2026) — BRIEF PROJET UNIQUE, RELIÉ AU RENDU.
//
// Un seul objet versionné par étude (« BriefProjet ») rassemble la vision du promoteur :
//   · Style & tendances : cible, direction retenue (palette hex, matériaux, intention), références ;
//   · Programmation (promoteurProgramme.store) : typologies T1–T5, mix (bâtiments, niveaux, SHAB) ;
//   · habillage choisi dans le chat (carte « Brief créatif » / fiche Espace 3D) ;
//   · réglages de rendu : gamme, vues du catalogue (pack plaquette par défaut), ambiance, saison, précisions.
// Il voyage dans le contrat `mimmoza-projet-v2` (champs FACULTATIFS programme.typologies/mix, brief, rendu) par
// UNE SEULE fonction (`projetAvecBriefProjet`), appelée par les deux chemins de lancement (chat et
// FilmVisitePanel, via construireProjetChat). Le Studio le traduit en ArchitecturalDesignBrief.
//
// Code PUR (aucun accès au navigateur) : partagé par le front et l'Edge Function copilot-chat.
// La persistance (userStorage scopé par compte, comme le programme et Style & tendances) est dans
// src/spaces/promoteur/shared/briefProjet.store.ts.
// =============================================================================

import {
  AMBIANCES_V2, GAMMES_V2, SAISONS_V2, TYPES_LOGEMENT_V2, validerProjet,
  type AmbianceV2, type BriefV2, type GammeV2, type MixV2, type ProjetMimmozaV2, type RenduV2, type RoleMateriauV2, type SaisonV2, type TypologieV2,
} from '../../spaces/promoteur/shared/echangeStudio/mimmozaProjetV2.ts';
import { estVueCatalogue, VUES_CATALOGUE, type VueCatalogue } from './catalogueVues.ts';

export const BRIEF_PROJET_VERSION = 1 as const;

export interface BriefProjet {
  version: typeof BRIEF_PROJET_VERSION;
  etudeId: string | null;
  /** Incrémentée à chaque enregistrement dont le contenu change. */
  revision: number;
  majLe: string;
  cible: string | null;
  gamme: GammeV2 | null;
  directionStyle: { famille: string | null; titre: string | null; intention: string | null } | null;
  palette: { nom: string; hex: string; usage: string | null }[];
  /** Matériaux : ceux de l'habillage (rôle explicite) d'abord, puis ceux de la direction retenue. */
  materiaux: { role: RoleMateriauV2; libelle: string }[];
  references: { titre: string; url: string | null; note: string | null }[];
  programme: { typologies: TypologieV2[]; mix: MixV2 | null };
  rendu: { vues: VueCatalogue[]; ambiance: AmbianceV2 | null; saison: SaisonV2 | null };
  precisions: string | null;
  /** Provenance de chaque partie (date ISO de la source, null si absente) — affichée, jamais devinée. */
  sources: { style: string | null; programme: string | null; habillage: string | null };
}

/** Champs du contrat v2 portés par le brief (seulement ceux qui ont un contenu). */
export interface ChampsContratBrief {
  programme?: { typologies?: TypologieV2[]; mix?: MixV2 };
  brief?: BriefV2;
  rendu?: RenduV2;
}

export const LIBELLES_GAMME: Record<GammeV2, string> = { entree: 'Entrée de gamme', standard: 'Standard', premium: 'Premium', luxe: 'Luxe' };
export const LIBELLES_SAISON: Record<SaisonV2, string> = { printemps: 'Printemps', ete: 'Été', automne: 'Automne', hiver: 'Hiver' };
export const LIBELLES_AMBIANCE_RENDU: Record<AmbianceV2, string> = { jour: 'Journée', fin_de_journee: 'Fin de journée', crepuscule: 'Crépuscule' };
export const PRECISIONS_PROJET_MAX = 300;

const estObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const txt = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = Array.from(v, (c) => (c.charCodeAt(0) < 32 ? ' ' : c)).join('').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};
const RE_HEX = /^#[0-9a-fA-F]{6}$/;
const lienHttps = (v: unknown): string | null => {
  const t = txt(v, 500);
  if (!t) return null;
  try { return new URL(t).protocol === 'https:' ? t : null; } catch { return null; }
};

export function briefProjetVide(etudeId: string | null): BriefProjet {
  return {
    version: BRIEF_PROJET_VERSION, etudeId, revision: 0, majLe: new Date(0).toISOString(),
    cible: null, gamme: null, directionStyle: null, palette: [], materiaux: [], references: [],
    programme: { typologies: [], mix: null },
    // Vues : vide tant que le promoteur n'a rien choisi (les sélecteurs pré-cochent alors le pack plaquette).
    rendu: { vues: [], ambiance: null, saison: null },
    precisions: null,
    sources: { style: null, programme: null, habillage: null },
  };
}

/** Lecture défensive (stockage, bloc de message) : tout ce qui est hors format est écarté, jamais deviné. */
export function lireBriefProjet(brut: unknown): BriefProjet | null {
  if (!estObj(brut) || brut.version !== BRIEF_PROJET_VERSION) return null;
  const b = briefProjetVide(txt(brut.etudeId, 128));
  const ds = estObj(brut.directionStyle) ? brut.directionStyle : null;
  const prog = estObj(brut.programme) ? brut.programme : {};
  const rendu = estObj(brut.rendu) ? brut.rendu : {};
  const sources = estObj(brut.sources) ? brut.sources : {};
  const vues = Array.isArray(rendu.vues) ? rendu.vues.filter(estVueCatalogue) : null;
  return {
    ...b,
    revision: typeof brut.revision === 'number' && Number.isInteger(brut.revision) && brut.revision >= 0 ? brut.revision : 0,
    majLe: txt(brut.majLe, 40) ?? b.majLe,
    cible: txt(brut.cible, 300),
    gamme: (GAMMES_V2 as readonly unknown[]).includes(brut.gamme) ? brut.gamme as GammeV2 : null,
    directionStyle: ds ? { famille: txt(ds.famille, 40), titre: txt(ds.titre, 120), intention: txt(ds.intention, 600) } : null,
    palette: (Array.isArray(brut.palette) ? brut.palette : []).filter(estObj)
      .filter((c) => typeof c.hex === 'string' && RE_HEX.test(c.hex) && txt(c.nom, 80))
      .slice(0, 12).map((c) => ({ nom: txt(c.nom, 80)!, hex: String(c.hex).toLowerCase(), usage: txt(c.usage, 160) })),
    materiaux: (Array.isArray(brut.materiaux) ? brut.materiaux : []).filter(estObj)
      .filter((m) => typeof m.role === 'string' && ['facade', 'menuiseries', 'garde_corps', 'soubassement', 'toiture', 'interieur', 'autre'].includes(m.role) && txt(m.libelle, 160))
      .slice(0, 24).map((m) => ({ role: m.role as RoleMateriauV2, libelle: txt(m.libelle, 160)! })),
    references: (Array.isArray(brut.references) ? brut.references : []).filter(estObj).filter((r) => txt(r.titre, 160))
      .slice(0, 12).map((r) => ({ titre: txt(r.titre, 160)!, url: lienHttps(r.url), note: txt(r.note, 400) })),
    programme: {
      typologies: (Array.isArray(prog.typologies) ? prog.typologies : []).filter(estObj)
        .filter((t) => (TYPES_LOGEMENT_V2 as readonly unknown[]).includes(t.type) && Number.isInteger(t.nombre) && (t.nombre as number) >= 0)
        .map((t) => ({ type: t.type as TypologieV2['type'], nombre: t.nombre as number, shabM2: typeof t.shabM2 === 'number' && t.shabM2 >= 5 && t.shabM2 <= 1000 ? t.shabM2 : null }))
        .filter((t, i, l) => l.findIndex((x) => x.type === t.type) === i),
      mix: estObj(prog.mix) ? lireMix(prog.mix) : null,
    },
    rendu: {
      vues: vues ? VUES_CATALOGUE.filter((v) => vues.includes(v)) : b.rendu.vues,
      ambiance: (AMBIANCES_V2 as readonly unknown[]).includes(rendu.ambiance) ? rendu.ambiance as AmbianceV2 : null,
      saison: (SAISONS_V2 as readonly unknown[]).includes(rendu.saison) ? rendu.saison as SaisonV2 : null,
    },
    precisions: txt(brut.precisions, PRECISIONS_PROJET_MAX),
    sources: { style: txt(sources.style, 40), programme: txt(sources.programme, 40), habillage: txt(sources.habillage, 40) },
  };
}

function lireMix(m: Record<string, unknown>): MixV2 | null {
  const ent = (v: unknown, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max ? v : null);
  const shab = typeof m.shabTotaleM2 === 'number' && Number.isFinite(m.shabTotaleM2) && m.shabTotaleM2 >= 0 && m.shabTotaleM2 <= 1e7 ? m.shabTotaleM2 : null;
  const mix: MixV2 = { batiments: ent(m.batiments, 40), niveaux: ent(m.niveaux, 100), shabTotaleM2: shab, nature: 'vise' };
  return mix.batiments === null && mix.niveaux === null && mix.shabTotaleM2 === null ? null : mix;
}

// ── Sources ──────────────────────────────────────────────────────────────────

/** Ce dont le brief a besoin de Style & tendances (structure minimale de DesignBrief, sans dépendance). */
export interface SourceStyle {
  target: string;
  selectedFamily: string | null;
  adjustments?: string;
  generatedAt?: string;
  directions: { family: string; title: string; intent: string; palette: { name: string; hex: string; use: string }[]; materials: string[]; sourceIds: string[] }[];
}
export interface SourceReference { id: string; title: string; url: string; observation: string }

/** Style & tendances → cible, direction RETENUE (palette, matériaux), références de la direction. Rien sans direction retenue. */
export function partieStyle(style: SourceStyle | null, sources: readonly SourceReference[] = []): Pick<BriefProjet, 'cible' | 'directionStyle' | 'palette' | 'references'> & { materiauxStyle: string[] } {
  const d = style?.directions.find((x) => x.family === style.selectedFamily) ?? null;
  return {
    cible: txt(style?.target, 300),
    directionStyle: d ? { famille: txt(d.family, 40), titre: txt(d.title, 120), intention: txt(d.intent, 600) } : null,
    palette: d ? d.palette.filter((c) => RE_HEX.test(c.hex) && txt(c.name, 80)).slice(0, 12).map((c) => ({ nom: txt(c.name, 80)!, hex: c.hex.toLowerCase(), usage: txt(c.use, 160) })) : [],
    references: d ? sources.filter((s) => d.sourceIds.includes(s.id) && txt(s.title, 160)).slice(0, 12)
      .map((s) => ({ titre: txt(s.title, 160)!, url: lienHttps(s.url), note: txt(s.observation, 400) })) : [],
    materiauxStyle: d ? d.materials.map((m) => txt(m, 160)).filter((m): m is string => !!m).slice(0, 12) : [],
  };
}

/** Programme du store (structure minimale de ProgrammeMix) → typologies agrégées et mix. */
export interface SourceProgramme {
  batiments: { niveaux: number; typologies: Partial<Record<string, number>>; surfaces: Partial<Record<string, number>> }[];
  updatedAt?: string;
}
export function partieProgramme(p: SourceProgramme | null): BriefProjet['programme'] {
  if (!p || !Array.isArray(p.batiments) || !p.batiments.length) return { typologies: [], mix: null };
  const typologies: TypologieV2[] = [];
  let shabTotale = 0;
  let shabConnue = true;
  for (const type of TYPES_LOGEMENT_V2) {
    let n = 0;
    let surface = 0;
    for (const b of p.batiments) {
      const k = Math.max(0, Math.floor(Number(b.typologies?.[type]) || 0));
      const s = Number(b.surfaces?.[type]);
      n += k;
      if (k > 0) { if (Number.isFinite(s) && s > 0) surface += k * s; else shabConnue = false; }
    }
    if (n > 0) {
      const moyenne = surface > 0 ? Math.round((surface / n) * 10) / 10 : null;
      typologies.push({ type, nombre: Math.min(n, 20_000), shabM2: moyenne !== null && moyenne >= 5 && moyenne <= 1000 ? moyenne : null });
      shabTotale += surface;
    }
  }
  const niveaux = Math.max(...p.batiments.map((b) => Math.floor(Number(b.niveaux) || 0)));
  const mix: MixV2 = {
    batiments: p.batiments.length >= 1 && p.batiments.length <= 40 ? p.batiments.length : null,
    niveaux: niveaux >= 1 && niveaux <= 100 ? niveaux : null,
    shabTotaleM2: typologies.length && shabConnue ? Math.round(shabTotale) : null,
    nature: 'vise',
  };
  return { typologies, mix: typologies.length ? mix : null };
}

/** Choix d'habillage (carte du chat : mêmes valeurs que briefCreatif.ts / studio.ts validerBrief). */
export interface SourceHabillage {
  facade?: string; teinte?: string; menuiseries?: string; garde_corps?: string; soubassement?: string; toiture?: string; balcons?: string; ambiance?: string;
  precisions?: string | null;
}
/** Libellés lus par le lexique du Studio (intentionMaterielle.ts LEXIQUE_MATIERES, depuisProjetMimmoza.ts). */
export function materiauxHabillage(h: SourceHabillage | null): { role: RoleMateriauV2; libelle: string }[] {
  if (!h) return [];
  const facade = h.facade === 'brique' ? (h.teinte === 'claire' ? 'brique claire' : 'brique rouge')
    : h.facade === 'beton' ? (h.teinte === 'claire' ? 'béton blanc' : 'béton brut')
    : h.facade === 'bardage_bois' ? (h.teinte === 'foncee' ? 'bois brûlé' : 'bardage bois')
    : h.facade === 'enduit_clair' ? 'enduit beige' : h.facade === 'enduit_blanc' ? 'enduit blanc'
    : h.facade === 'pierre' ? 'pierre claire' : h.facade === 'verre' ? 'verre teinté' : null;
  const menuiseries = ({ gris: 'menuiseries aluminium gris', anthracite: 'menuiseries anthracite', blanc: 'menuiseries blanches', bronze: 'menuiseries bronze' } as Record<string, string>)[h.menuiseries ?? ''];
  const gardeCorps = h.balcons === 'aucun' ? undefined : ({ metal: 'garde-corps métal', verre: 'garde-corps en verre', plein: 'garde-corps pleins' } as Record<string, string>)[h.garde_corps ?? ''];
  const soubassement = ({ pierre: 'soubassement en pierre', beton: 'soubassement en béton', brique: 'soubassement en brique' } as Record<string, string>)[h.soubassement ?? ''];
  const toiture = ({ vegetalisee: 'toiture végétalisée', deux_pans_tuiles: 'toiture en tuiles', deux_pans_ardoise: 'toiture en ardoise', deux_pans_zinc: 'toiture en zinc' } as Record<string, string>)[h.toiture ?? ''];
  return [
    ...(facade ? [{ role: 'facade' as const, libelle: facade }] : []),
    ...(menuiseries ? [{ role: 'menuiseries' as const, libelle: menuiseries }] : []),
    ...(gardeCorps ? [{ role: 'garde_corps' as const, libelle: gardeCorps }] : []),
    ...(soubassement ? [{ role: 'soubassement' as const, libelle: soubassement }] : []),
    ...(toiture ? [{ role: 'toiture' as const, libelle: toiture }] : []),
  ];
}

/** Réglages saisis par le promoteur (Style & tendances, FilmVisitePanel, carte du devis). */
export interface ReglagesRendu {
  gamme?: GammeV2 | null;
  vues?: readonly VueCatalogue[];
  ambiance?: AmbianceV2 | null;
  saison?: SaisonV2 | null;
  precisions?: string | null;
}

/**
 * Assemble le brief à partir de ses sources. `precedent` : brief déjà enregistré (révision, réglages, habillage).
 * La révision n'augmente que si le CONTENU change (empreinte).
 */
export function assemblerBriefProjet(e: {
  etudeId: string | null;
  precedent: BriefProjet | null;
  style: SourceStyle | null;
  references?: readonly SourceReference[];
  programme: SourceProgramme | null;
  habillage?: SourceHabillage | null;
  reglages?: ReglagesRendu;
  maintenant: string;
  dates?: Partial<BriefProjet['sources']>;
}): BriefProjet {
  const p = e.precedent ?? briefProjetVide(e.etudeId);
  const s = partieStyle(e.style, e.references ?? []);
  const deHabillage = e.habillage === undefined ? p.materiaux.filter((m) => m.role !== 'autre') : materiauxHabillage(e.habillage);
  const materiaux = [
    ...deHabillage,
    // Matériaux de la direction retenue : rôle lu dans le libellé par le Studio (« autre »), après l'habillage.
    ...s.materiauxStyle.map((libelle) => ({ role: 'autre' as const, libelle })),
  ].filter((m, i, l) => l.findIndex((x) => x.role === m.role && x.libelle === m.libelle) === i).slice(0, 24);
  const r = e.reglages ?? {};
  const habAmb = e.habillage?.ambiance === 'jour' || e.habillage?.ambiance === 'fin_de_journee' ? e.habillage.ambiance : null;
  const vuesChoisies = r.vues ? VUES_CATALOGUE.filter((v) => r.vues!.includes(v)) : p.rendu.vues;
  const suivant: BriefProjet = {
    version: BRIEF_PROJET_VERSION,
    etudeId: e.etudeId,
    revision: p.revision,
    majLe: p.majLe,
    cible: s.cible ?? p.cible,
    gamme: r.gamme !== undefined ? r.gamme : p.gamme,
    directionStyle: s.directionStyle ?? (e.style ? null : p.directionStyle),
    palette: e.style ? s.palette : p.palette,
    materiaux,
    references: e.style ? s.references : p.references,
    programme: e.programme ? partieProgramme(e.programme) : p.programme,
    rendu: {
      vues: vuesChoisies,
      ambiance: r.ambiance !== undefined ? r.ambiance : habAmb ?? p.rendu.ambiance,
      saison: r.saison !== undefined ? r.saison : p.rendu.saison,
    },
    precisions: r.precisions !== undefined ? txt(r.precisions, PRECISIONS_PROJET_MAX) : p.precisions,
    sources: {
      style: e.dates?.style ?? (e.style ? (e.style.generatedAt ?? p.sources.style) : p.sources.style),
      programme: e.dates?.programme ?? (e.programme ? (e.programme.updatedAt ?? p.sources.programme) : p.sources.programme),
      habillage: e.dates?.habillage ?? p.sources.habillage,
    },
  };
  const change = empreinteBriefProjet(suivant) !== empreinteBriefProjet(p) || e.precedent === null;
  return change ? { ...suivant, revision: p.revision + 1, majLe: e.maintenant } : { ...suivant, revision: p.revision, majLe: p.majLe };
}

// ── Contrat ──────────────────────────────────────────────────────────────────

/** Brief → champs facultatifs du contrat v2 (ceux qui ont un contenu ; objet vide si rien). */
export function champsContrat(b: BriefProjet | null): ChampsContratBrief {
  if (!b) return {};
  const out: ChampsContratBrief = {};
  const programme: ChampsContratBrief['programme'] = {
    ...(b.programme.typologies.length ? { typologies: b.programme.typologies.map((t) => ({ ...t })) } : {}),
    ...(b.programme.mix ? { mix: { ...b.programme.mix } } : {}),
  };
  if (Object.keys(programme).length) out.programme = programme;
  const aBrief = b.cible || b.gamme || b.directionStyle || b.palette.length || b.materiaux.length || b.references.length || b.precisions;
  if (aBrief) {
    out.brief = {
      cible: b.cible, gamme: b.gamme, directionStyle: b.directionStyle ? { ...b.directionStyle } : null,
      palette: b.palette.map((c) => ({ ...c })), materiaux: b.materiaux.map((m) => ({ ...m })),
      references: b.references.map((r) => ({ ...r })), precisions: b.precisions,
    };
  }
  if (b.rendu.vues.length || b.rendu.ambiance || b.rendu.saison) out.rendu = { vues: [...b.rendu.vues], ambiance: b.rendu.ambiance, saison: b.rendu.saison };
  return out;
}

/**
 * LE point de passage UNIQUE du brief vers le contrat v2 (chat ET FilmVisitePanel, via construireProjetChat).
 * Sans brief (ou brief vide) : le MÊME objet est rendu (rétrocompatibilité stricte).
 */
export function projetAvecBriefProjet(projet: ProjetMimmozaV2, champs: ChampsContratBrief | null | undefined): { ok: true; projet: ProjetMimmozaV2 } | { ok: false; erreur: string } {
  if (!champs || (!champs.programme && !champs.brief && !champs.rendu)) return { ok: true, projet };
  const lu = validerProjet({
    ...projet,
    programme: { ...projet.programme, ...(champs.programme ?? {}) },
    ...(champs.brief ? { brief: champs.brief } : {}),
    ...(champs.rendu ? { rendu: champs.rendu } : {}),
  });
  if ('erreur' in lu) return { ok: false, erreur: lu.erreur };
  return { ok: true, projet: lu.projet };
}

/** Lecture défensive des champs du contrat reçus dans un bloc de message (structure seulement ; le contrat valide le reste). */
export function lireChampsContrat(brut: unknown): ChampsContratBrief | null {
  if (!estObj(brut)) return null;
  if (Object.keys(brut).some((k) => !['programme', 'brief', 'rendu'].includes(k))) return null;
  if (JSON.stringify(brut).length > 12_000) return null;
  const out: ChampsContratBrief = {};
  if (brut.programme !== undefined) {
    if (!estObj(brut.programme) || Object.keys(brut.programme).some((k) => !['typologies', 'mix'].includes(k))) return null;
    out.programme = brut.programme as ChampsContratBrief['programme'];
  }
  if (brut.brief !== undefined) { if (!estObj(brut.brief)) return null; out.brief = brut.brief as unknown as BriefV2; }
  if (brut.rendu !== undefined) { if (!estObj(brut.rendu)) return null; out.rendu = brut.rendu as unknown as RenduV2; }
  return out;
}

function fnv1a(s: string, graine: number): string {
  let h = graine >>> 0;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
function canonique(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonique).join(',')}]`;
  if (estObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonique(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
/** Empreinte (16 hex) de ce que le brief transmet au rendu (champs du contrat) ; « vide » si rien. */
export function empreinteChamps(c: ChampsContratBrief | null | undefined): string {
  if (!c || (!c.programme && !c.brief && !c.rendu)) return 'vide';
  const s = canonique(c);
  return fnv1a(s, 0x811c9dc5) + fnv1a(s, 0x01234567);
}
export function empreinteBriefProjet(b: BriefProjet): string {
  return empreinteChamps(champsContrat(b));
}

/** Résumé lisible (devis, panneau) : « Premium · direction Durable chaleureux · 20 logements (T2 × 12, T3 × 8) · 4 vues ». */
export function resumeBriefProjet(b: BriefProjet | null): string | null {
  if (!b) return null;
  const nb = b.programme.typologies.reduce((s, t) => s + t.nombre, 0);
  const parts = [
    b.gamme ? LIBELLES_GAMME[b.gamme] : null,
    b.directionStyle?.titre ? `direction ${b.directionStyle.titre}` : null,
    nb ? `${String(nb)} logement${nb > 1 ? 's' : ''} (${b.programme.typologies.filter((t) => t.nombre > 0).map((t) => `${t.type} × ${String(t.nombre)}`).join(', ')})` : null,
    b.palette.length ? `palette de ${String(b.palette.length)} couleur${b.palette.length > 1 ? 's' : ''}` : null,
    b.rendu.saison ? LIBELLES_SAISON[b.rendu.saison].toLowerCase() : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** Matière de façade du brief (rôle « facade », libellé du lexique du Studio) ; null si le brief n'en donne pas. */
export function facadeDesChamps(c: ChampsContratBrief | null | undefined): string | null {
  return c?.brief?.materiaux.find((m) => m.role === 'facade')?.libelle ?? null;
}
