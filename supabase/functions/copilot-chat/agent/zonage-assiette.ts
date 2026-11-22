// LOT SUITE-1 — ZONAGE PLU D'UNE ASSIETTE MULTI-PARCELLES.
//
// Avant : la zone d'une assiette groupée (VIS-15) était lue au CENTROÏDE DE L'UNION — une parcelle en UA et
// sa voisine en UB donnaient une seule zone, au hasard de la forme. Désormais :
//   1. la zone est lue (get_zonage_plu) au centre de CHAQUE parcelle de l'assiette ;
//   2. toutes dans la même zone → comportement inchangé (cette zone est lue) ;
//   3. zones différentes → la liste par parcelle est conservée dans la conception (parcelle.assiette.zonage) ;
//      la zone de la parcelle la plus grande est lue d'abord, puis UNE lecture complémentaire au plus par
//      autre zone ; dès que deux zones sont lues, la règle la plus contraignante s'applique RÈGLE PAR RÈGLE
//      (hauteur la plus basse, emprise la plus faible, reculs les plus grands…) ; une zone non lue → zone de la
//      parcelle la plus grande + avertissement « zone X non lue ». L'hypothèse est toujours DITE (carte, rapport).
// Module PUR (aucun réseau) : la lecture des zones est injectée.

import { completerRegles, confirmeeParUtilisateur, type RegleCle, type RegleConception } from './conception.ts';

export interface ZoneParcelle { idu: string; zone: string | null; surface_m2: number }

export interface ZonageAssiette {
  parcelles: ZoneParcelle[];
  /** Zones distinctes lues (ordre : zone de la parcelle la plus grande d'abord). */
  zones: string[];
  mixte: boolean;
  /** Zone de la parcelle la plus grande (zone par défaut). */
  zone_principale: string | null;
  /** Règles lues, par zone (au plus une lecture par zone). */
  regles_par_zone: Record<string, RegleConception[]>;
  /** Zones dont la lecture a été lancée (jamais relancée : une lecture au plus par zone). */
  lectures_tentees: string[];
  /** Règle → zone retenue (la plus contraignante), quand au moins deux zones sont lues. */
  retenues?: Partial<Record<RegleCle, string>>;
  /** Hypothèse dite à l'utilisateur (null : assiette dans une seule zone). */
  hypothese: string | null;
}

export interface ParcelleAvecCentre { idu: string; surface_m2: number | null; surface_calculee_m2?: number; centre?: { lat: number; lon: number } }

/** Sens « plus contraignant » des règles chiffrées comparables. recul_limites_formule (texte) n'est pas comparé. */
export const SENS_CONTRAINTE: Partial<Record<RegleCle, 'min' | 'max'>> = {
  hauteur_max_m: 'min', niveaux_max: 'min', emprise_sol_max_pct: 'min',
  recul_voie_m: 'max', recul_limites_m: 'max', pleine_terre_min_pct: 'max',
  stationnement_par_logement: 'max', mixite_sociale_pct: 'max',
};

const LIBELLES: Partial<Record<RegleCle, string>> = {
  hauteur_max_m: 'hauteur', niveaux_max: 'niveaux', emprise_sol_max_pct: 'emprise', recul_voie_m: 'recul voie',
  recul_limites_m: 'recul limites', pleine_terre_min_pct: 'pleine terre', stationnement_par_logement: 'stationnement', mixite_sociale_pct: 'mixité',
};

const court = (idu: string) => idu.length === 14 ? idu.slice(8) : idu;
const m2 = (n: number) => `${Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' ')} m²`;
const surf = (p: ParcelleAvecCentre) => p.surface_m2 ?? p.surface_calculee_m2 ?? 0;

/**
 * Lit la zone de chaque parcelle d'une assiette (au moins 2 parcelles, toutes avec un centre). null : rien à
 * faire (parcelle seule, assiette antérieure au lot sans centres, ou aucune zone lue) → ancien comportement.
 */
export async function lireZonesAssiette(
  parcelles: readonly ParcelleAvecCentre[], lireZone: (idu: string, pt: { lat: number; lon: number }) => Promise<string | null>,
  max = 8,
): Promise<ZonageAssiette | null> {
  if (parcelles.length < 2 || parcelles.length > max || parcelles.some((p) => !p.centre)) return null;
  const zones = await Promise.all(parcelles.map((p) => lireZone(p.idu, p.centre!).catch(() => null)));
  if (zones.every((z) => !z)) return null;
  const liste: ZoneParcelle[] = parcelles.map((p, i) => ({ idu: p.idu, zone: zones[i] ? zones[i]!.toUpperCase() : null, surface_m2: surf(p) }));
  const parTaille = [...liste].sort((a, b) => b.surface_m2 - a.surface_m2);
  const principale = parTaille.find((p) => p.zone)?.zone ?? null;
  const distinctes = [...new Set(parTaille.map((p) => p.zone).filter((z): z is string => !!z))];
  const z: ZonageAssiette = {
    parcelles: liste, zones: distinctes, mixte: distinctes.length > 1, zone_principale: principale,
    regles_par_zone: {}, lectures_tentees: [], hypothese: null,
  };
  z.hypothese = hypotheseZonage(z);
  return z;
}

/** Relit sans confiance un zonage stocké (parcelle.assiette.zonage). */
export function lireZonageStocke(brut: unknown): ZonageAssiette | null {
  const b = brut && typeof brut === 'object' ? brut as Partial<ZonageAssiette> : null;
  if (!b || !Array.isArray(b.parcelles) || !Array.isArray(b.zones)) return null;
  return {
    parcelles: b.parcelles.filter((p) => p && typeof p.idu === 'string').slice(0, 20),
    zones: b.zones.filter((x) => typeof x === 'string').slice(0, 10),
    mixte: b.mixte === true, zone_principale: typeof b.zone_principale === 'string' ? b.zone_principale : null,
    regles_par_zone: b.regles_par_zone && typeof b.regles_par_zone === 'object' ? b.regles_par_zone as Record<string, RegleConception[]> : {},
    lectures_tentees: Array.isArray(b.lectures_tentees) ? b.lectures_tentees.filter((x) => typeof x === 'string') : [],
    ...(b.retenues && typeof b.retenues === 'object' ? { retenues: b.retenues } : {}),
    hypothese: typeof b.hypothese === 'string' ? b.hypothese : null,
  };
}

/** Prochaine zone à lire : la principale d'abord, puis chaque autre zone une seule fois ; null quand tout est tenté. */
export function zoneALire(z: ZonageAssiette): string | null {
  return z.zones.find((x) => !z.lectures_tentees.includes(x)) ?? null;
}

/** Une lecture de la zone est lancée (jamais relancée ensuite, même si elle échoue). */
export function noterTentative(z: ZonageAssiette, zone: string): void {
  const Z = zone.toUpperCase();
  if (z.zones.includes(Z) && !z.lectures_tentees.includes(Z)) z.lectures_tentees.push(Z);
}

const chiffree = (r: RegleConception | undefined): r is RegleConception & { valeur: number } =>
  !!r && r.statut !== 'manquant' && typeof r.valeur === 'number' && Number.isFinite(r.valeur) && (r.nature ?? 'chiffree') === 'chiffree';

/** Règles lues pour une zone de l'assiette ; recalcule les règles retenues et l'hypothèse. false : zone hors assiette. */
export function enregistrerLectureZone(z: ZonageAssiette, zone: string | null, lues: RegleConception[]): boolean {
  const Z = zone?.toUpperCase() ?? '';
  if (!z.mixte || !z.zones.includes(Z)) return false;
  noterTentative(z, Z);
  z.regles_par_zone[Z] = lues.map((r) => ({ cle: r.cle, valeur: r.valeur, unite: r.unite, statut: r.statut, source: r.source,
    ...(r.article ? { article: r.article } : {}), ...(r.nature ? { nature: r.nature } : {}), ...(r.texte ? { texte: r.texte.slice(0, 300) } : {}) }));
  const lus = Object.keys(z.regles_par_zone);
  if (lus.length >= 2) z.retenues = reglesPlusContraignantes(z).retenues;
  z.hypothese = hypotheseZonage(z);
  return true;
}

/**
 * Règle par règle, la valeur la plus contraignante parmi les zones LUES (règles chiffrées seulement ; une règle
 * chiffrée l'emporte sur une règle absente ou non réglementée). La règle retenue garde sa source et son article ;
 * son texte dit la zone retenue et les valeurs des autres zones.
 */
export function reglesPlusContraignantes(z: ZonageAssiette): { regles: RegleConception[]; retenues: Partial<Record<RegleCle, string>> } {
  const regles: RegleConception[] = [];
  const retenues: Partial<Record<RegleCle, string>> = {};
  const zones = z.zones.filter((x) => z.regles_par_zone[x]);
  for (const [cle, sens] of Object.entries(SENS_CONTRAINTE) as Array<[RegleCle, 'min' | 'max']>) {
    const cand = zones.map((zo) => ({ zo, r: z.regles_par_zone[zo].find((r) => r.cle === cle) })).filter((x) => chiffree(x.r)) as
      Array<{ zo: string; r: RegleConception & { valeur: number } }>;
    if (!cand.length) continue;
    const best = cand.reduce((a, b) => (sens === 'min' ? b.r.valeur < a.r.valeur : b.r.valeur > a.r.valeur) ? b : a);
    retenues[cle] = best.zo;
    const autres = zones.filter((zo) => zo !== best.zo).map((zo) => {
      const r = z.regles_par_zone[zo].find((x) => x.cle === cle);
      return `${zo} : ${chiffree(r) ? `${r.valeur} ${r.unite}` : 'non chiffrée'}`;
    });
    regles.push({ ...best.r, texte: `${best.r.texte ? `${best.r.texte} — ` : ''}assiette multi-zones : zone ${best.zo} retenue, la plus contraignante (${autres.join(' ; ')}).`.slice(0, 600) });
  }
  return { regles, retenues };
}

/** Applique les règles retenues aux règles de la conception (jamais sur une règle confirmée par l'utilisateur). */
export function appliquerZonageAuxRegles(actuelles: RegleConception[], z: ZonageAssiette): RegleConception[] {
  if (!z.mixte || Object.keys(z.regles_par_zone).length < 2) return actuelles;
  const { regles } = reglesPlusContraignantes(z);
  const par = new Map(regles.map((r) => [r.cle, r]));
  return completerRegles(actuelles).map((a) => par.has(a.cle) && !confirmeeParUtilisateur(a) ? par.get(a.cle)! : a);
}

/** Hypothèse lisible (carte du Dossier 3D, rapport). null : une seule zone, toutes parcelles lues. */
export function hypotheseZonage(z: ZonageAssiette): string | null {
  const inconnues = z.parcelles.filter((p) => !p.zone);
  const noteInconnues = inconnues.length ? ` Zone non lue au Géoportail pour ${inconnues.map((p) => court(p.idu)).join(', ')} : à vérifier.` : '';
  if (!z.mixte) return inconnues.length ? `Zonage de l’assiette : zone ${z.zone_principale ?? '?'} retenue.${noteInconnues}` : null;
  const liste = z.parcelles.map((p) => `${court(p.idu)} : ${p.zone ?? '?'}`).join(' ; ');
  const tete = `Zonage de l’assiette : parcelles en zones différentes (${liste}).`;
  const lues = z.zones.filter((x) => z.regles_par_zone[x]);
  const nonLues = z.zones.filter((x) => !z.regles_par_zone[x]);
  if (lues.length >= 2) {
    const ret = z.retenues ?? {};
    const detail = (Object.keys(SENS_CONTRAINTE) as RegleCle[]).filter((c) => ret[c]).map((c) => `${LIBELLES[c]} : ${ret[c]}`).join(', ');
    return `${tete} Hypothèse retenue : la règle la plus contraignante des zones ${lues.join(' et ')}, règle par règle${detail ? ` (${detail})` : ''}.` +
      `${nonLues.length ? ` Zone ${nonLues.join(', ')} non lue : à vérifier.` : ''} À confirmer avec le service urbanisme.${noteInconnues}`;
  }
  const retenue = lues[0] ?? z.zone_principale;
  const grande = [...z.parcelles].filter((p) => p.zone === retenue).sort((a, b) => b.surface_m2 - a.surface_m2)[0];
  const pourquoi = retenue === z.zone_principale
    ? `celle de la parcelle la plus grande${grande ? ` (${court(grande.idu)}, ${m2(grande.surface_m2)})` : ''}`
    : 'seule zone dont le règlement a été lu';
  return `${tete} Hypothèse retenue : zone ${retenue}, ${pourquoi} ; ` +
    `zone ${z.zones.filter((x) => x !== retenue).join(', ')} non lue : ses règles peuvent être plus contraignantes, à vérifier avant toute conclusion.${noteInconnues}`;
}
