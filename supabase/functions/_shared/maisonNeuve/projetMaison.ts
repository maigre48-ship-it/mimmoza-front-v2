// supabase/functions/_shared/maisonNeuve/projetMaison.ts
// =============================================================================
// LOT G10b (18/11/2026) — Gabarit placé (gabaritMaison.ts) → PROJET DE MAISON NEUVE transmis à la machine de rendu
// (contratMaison.ts). Module PUR : conversions Lambert-93 ↔ WGS 84 et géométrie seulement ; rien n'est deviné.
// Les conventions Mimmoza (façade en enduit clair, menuiseries anthracite, tuiles) sont SUPPOSÉES et dites.
// =============================================================================

import type { Donnee, FormeToit } from '../extension/contrat.ts';
import { lambert93VersWgs84 } from '../extension/lambert93.ts';
import type { Pt } from '../extension/geometrie.ts';
import type { GabaritMaison, ParcelleMaison } from './gabaritMaison.ts';
import type { DemandeMaison } from './instructionsMaison.ts';
import { normaliser } from './instructionsMaison.ts';
import type { AutorisationMaison } from './parcoursMaison.ts';
import {
  FORMAT_PROJET_MAISON, lireProjetMaison, VERSION_PROJET_MAISON,
  type CouvertureMaison, type DonneeMaison, type ProjetMaison,
} from './contratMaison.ts';

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const r7 = (v: number): number => Math.round(v * 1e7) / 1e7;
const r9 = (v: number): number => Math.round(v * 1e9) / 1e9;

/** Matériau de couverture dit explicitement (« tuiles », « ardoise », « zinc »). Pur. */
export function lireCouverture(texte: string | null | undefined): CouvertureMaison | null {
  const t = normaliser(texte ?? '');
  if (/\bardoises?\b/.test(t)) return 'ardoise';
  if (/\bzinc\b/.test(t)) return 'zinc';
  if (/\btuiles?\b/.test(t)) return 'tuiles';
  return null;
}

/** Rotation au sens du contrat v2 (x = est, y = sud) du grand côté du rectangle, dans ]−90, 90]. Pur. */
export function rotationDuRectangle(coins: readonly Pt[]): { rotationDeg: number; longueurM: number; largeurM: number } {
  const [a, b, c] = coins as [Pt, Pt, Pt, Pt];
  const l01 = Math.hypot(b.x - a.x, b.z - a.z);
  const l12 = Math.hypot(c.x - b.x, c.z - b.z);
  const [dx, dz] = l01 >= l12 ? [b.x - a.x, b.z - a.z] : [c.x - b.x, c.z - b.z];
  let deg = (Math.atan2(dz, dx) * 180) / Math.PI;
  if (deg <= -90) deg += 180;
  if (deg > 90) deg -= 180;
  return { rotationDeg: Math.round(deg * 1e6) / 1e6, longueurM: r3(Math.max(l01, l12)), largeurM: r3(Math.min(l01, l12)) };
}

export interface EntreeProjetMaison {
  readonly idu: string;
  readonly commune: string | null;
  readonly date: string;
  readonly contourWgs84: readonly (readonly [number, number])[];
  readonly surfaceM2: number | null;
  readonly origineL93: readonly [number, number];
  readonly parcelle: ParcelleMaison;
  readonly facadesVoie: readonly { readonly debut: readonly [number, number]; readonly fin: readonly [number, number] }[];
  readonly gabarit: GabaritMaison;
  readonly demande: DemandeMaison;
  readonly couverture: Donnee<CouvertureMaison> | null;
  readonly autorisation: AutorisationMaison;
  readonly hypotheses: readonly string[];
}

const conv = <T,>(d: Donnee<T>): DonneeMaison<T> => ({ valeur: d.valeur, statut: d.statut, source: d.source.slice(0, 300) });

/** Projet de maison (contrat validé) ; erreurs si le gabarit ne peut pas être transmis tel quel. Pur. */
export function projetMaisonDepuisGabarit(e: EntreeProjetMaison): { ok: true; projet: ProjetMaison } | { ok: false; erreurs: readonly string[] } {
  const g = e.gabarit;
  const cx = g.coins.reduce((s, p) => s + p.x, 0) / g.coins.length;
  const cz = g.coins.reduce((s, p) => s + p.z, 0) / g.coins.length;
  // Repère de calcul : x = est, z = sud → Lambert-93 (est, nord).
  const [lon, lat] = lambert93VersWgs84(e.origineL93[0] + cx, e.origineL93[1] - cz);
  const rot = rotationDuRectangle(g.coins);
  const toit: FormeToit = g.toit.valeur;
  const couverture: DonneeMaison<CouvertureMaison> | null = toit === 'plat' ? null
    : e.couverture ? conv(e.couverture)
      : { valeur: 'tuiles', statut: 'supposee', source: 'convention Mimmoza : couverture non dite, tuiles SUPPOSÉES' };
  const brut: ProjetMaison = {
    format: FORMAT_PROJET_MAISON,
    version: VERSION_PROJET_MAISON,
    idu: e.idu,
    commune: e.commune,
    date: e.date,
    parcelle: {
      // Même anneau que le contour de calcul (un sommet par limite) : relu du repère de calcul (aucun point de fermeture).
      contourWgs84: e.parcelle.contour.map((q) => { const [lo, la] = lambert93VersWgs84(e.origineL93[0] + q.x, e.origineL93[1] - q.z); return [r9(lo), r9(la)] as const; }),
      surfaceM2: e.surfaceM2,
      origineL93: [r3(e.origineL93[0]), r3(e.origineL93[1])],
      contourScene: e.parcelle.contour.map((p) => ({ x: r3(p.x), z: r3(p.z) })),
      categories: [...e.parcelle.categories],
    },
    facadesVoie: e.facadesVoie.map((f) => ({ debut: [r7(f.debut[0]), r7(f.debut[1])] as const, fin: [r7(f.fin[0]), r7(f.fin[1])] as const })),
    maison: {
      coinsScene: g.coins.map((p) => ({ x: r3(p.x), z: r3(p.z) })),
      centreWgs84: { lon: r9(lon), lat: r9(lat) },
      rotationDeg: rot.rotationDeg,
      longueurM: rot.longueurM,
      largeurM: rot.largeurM,
      empriseM2: r2(g.empriseM2),
      niveaux: conv(g.niveaux),
      egoutM: conv(g.egoutM),
      faitageM: conv(g.faitageM),
      toit: conv(g.toit),
      penteDeg: conv(g.penteDeg),
      surfaceHabitableM2: conv(e.demande.surfaceHabitableM2!),
      surfacePlancherM2: conv(g.surfacePlancherM2),
      surfacePlancherFourchette: [g.surfacePlancherFourchette[0], g.surfacePlancherFourchette[1]],
      facadeSurRue: g.facadeSurRue,
      reculs: g.reculs.map((r) => ({ limite: r.limite, categorie: r.categorie, requisM: r2(r.requis.valeur), statut: r.requis.statut, source: r.requis.source.slice(0, 300), mesureM: r3(r.mesureM) })),
    },
    habillage: {
      couverture,
      menuiseries: e.demande.menuiseries ? conv(e.demande.menuiseries) : { valeur: 'anthracite', statut: 'supposee', source: 'convention Mimmoza : menuiseries non dites, anthracite SUPPOSÉ' },
      facade: { valeur: 'enduit_clair', statut: 'supposee', source: 'convention Mimmoza : façades en enduit clair SUPPOSÉES (matière non demandée)' },
      style: e.demande.style ? conv(e.demande.style) : null,
    },
    autorisation: { regime: 'PC', architecte: e.autorisation.architecte, delaiMois: e.autorisation.delaiMois },
    hypotheses: e.hypotheses.slice(0, 30).map((h) => h.slice(0, 400)),
  };
  const lu = lireProjetMaison(JSON.parse(JSON.stringify(brut)));
  return 'projet' in lu ? { ok: true, projet: lu.projet } : { ok: false, erreurs: 'erreurs' in lu ? lu.erreurs : ['projet refusé'] };
}

/** Lignes de la synthèse sur ce qui sera dessiné (habillage et conventions dites). Pur. */
export function lignesHabillage(p: ProjetMaison): string[] {
  const h = p.habillage;
  const l: string[] = [];
  l.push(`Façades : enduit clair (${h.facade.statut === 'supposee' ? 'convention Mimmoza' : 'dit par vous'}).`);
  if (h.couverture) l.push(`Couverture : ${h.couverture.valeur === 'tuiles' ? 'tuiles' : h.couverture.valeur === 'ardoise' ? 'ardoise' : 'zinc'} (${h.couverture.statut === 'supposee' ? 'convention Mimmoza' : 'dite par vous'}).`);
  l.push(`Menuiseries : ${h.menuiseries.valeur} (${h.menuiseries.statut === 'supposee' ? 'convention Mimmoza' : 'dites par vous'})${h.menuiseries.valeur === 'bois' ? ' — le bois n’est pas encore disponible dans l’image : elles y seront anthracite, et c’est dit sur l’image' : ''}.`);
  l.push('Portes et fenêtres : placées par la règle de façade de Mimmoza (porte d’entrée au rez-de-chaussée d’une façade longue) ; plans et image les montrent au même endroit.');
  return l;
}
