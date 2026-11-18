// src/lib/studio/plansExtension.ts
// =============================================================================
// LOT G4 (17/11/2026) — PLANS DE L'EXTENSION livrés dans le chat avec l'image. Logique PURE (node --test / Deno).
//
// La machine de rendu dessine, depuis la scène qu'elle a RÉELLEMENT rendue, un PDF (plan de masse, plans de niveau,
// 2 façades, coupe), un zip de DXF (mètres réels) et un aperçu PNG de la 1re planche, rangés dans le seau privé
// `studio-rendus` à côté de l'image. Elle écrit `resultat.extension.plans` et l'EMPREINTE de la scène rendue
// (`resultat.extension.empreinte_scene`), la même que celle imprimée dans le cartouche de chaque planche.
//
// Ce module relit ce bloc tel quel (rien n'est complété) et refuse de proposer des plans :
//   · dont le PDF n'a pas été réellement envoyé (chemin absent) ;
//   · dont l'empreinte diffère de celle de l'image (jamais un plan qui n'est pas celui de l'image).
// Coût : 0 jeton (quelques secondes de calcul sur la machine de rendu), dit sur la carte.
// =============================================================================

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const txt = (v: unknown, n = 300): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const chemin = (v: unknown): string | null => {
  const c = txt(v, 400);
  // Chemin du seau privé : <user>/<job>/plans-extension…, sans remontée ni adresse complète.
  return c && /^[A-Za-z0-9-]+\/[A-Za-z0-9-]+\/plans-(?:extension|maison)[a-z0-9.-]*$/.test(c) && !c.includes('..') ? c : null;
};
const nombre = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const EMPREINTE = /^[0-9a-f]{64}$/;

export const TITRE_PLANS = 'Plans de votre extension';
export const COUT_PLANS_TEXTE = 'Plans gratuits (0 jeton) : quelques secondes de calcul sur la machine de rendu Mimmoza.';
export const MENTION_PLANS = 'Plans indicatifs, à faire valider par un professionnel avant tout dépôt.';
export const EVENEMENT_OUVRIR_PLANS_STUDIO = 'mimmoza:ouvrir-plans-studio';

export interface PlancheLue { numero: string; titre: string; echelle: string; format: string }

export type VuePlansExtension =
  | {
    etat: 'disponibles';
    pdfPath: string;
    dxfPath: string | null;
    apercuPath: string | null;
    /** Forme courte (12 caractères) de l'empreinte : la même que dans le cartouche et la preuve de l'image. */
    modele: string;
    planches: PlancheLue[];
    /** Lignes « Largeur 4,00 m (confirmée) »… écrites par la machine de rendu. */
    statuts: string[];
    avertissements: string[];
    cout: string;
    mention: string;
  }
  | { etat: 'indisponibles'; raison: string };

/** Noms proposés au téléchargement (sans accents). */
export const NOMS_TELECHARGEMENT = { pdf: 'plans-extension.pdf', dxf: 'plans-extension-dxf.zip' } as const;

/** LOT G10b — maison neuve : mêmes plans (bloc `resultat.maison.plans`), autre titre et autres noms de fichiers. */
export const TITRE_PLANS_MAISON = 'Plans de votre maison';
export const NOMS_TELECHARGEMENT_MAISON = { pdf: 'plans-maison.pdf', dxf: 'plans-maison-dxf.zip' } as const;
export type GenrePlans = 'extension' | 'maison';
/** Bloc de plans d'un travail : extension d'abord, sinon maison neuve. Pur. */
export function plansDuTravail(t: { resultat_extension?: unknown; resultat_maison?: unknown }): { genre: GenrePlans; vue: VuePlansExtension } | null {
  const x = lirePlansExtension(t.resultat_extension);
  if (x) return { genre: 'extension', vue: x };
  const m = lirePlansExtension(t.resultat_maison);
  return m ? { genre: 'maison', vue: m } : null;
}

/**
 * `resultat.extension` (machine de rendu) → plans à proposer. null : aucun bloc de plans (rendu antérieur, projet neuf)
 * — la carte n'affiche rien. Pur.
 */
export function lirePlansExtension(resultatExtension: unknown): VuePlansExtension | null {
  if (!estObj(resultatExtension) || !estObj(resultatExtension.plans)) return null;
  const p = resultatExtension.plans;
  const statut = txt(p.statut, 20);
  if (statut === 'echec') return { etat: 'indisponibles', raison: txt(p.raison) ?? 'Les plans n’ont pas pu être dessinés.' };
  const pdfPath = chemin(p.pdf_path);
  if (statut !== 'envoye' || !pdfPath) {
    return { etat: 'indisponibles', raison: txt(p.raison) ?? 'Les plans ont été dessinés mais ne sont pas encore accessibles.' };
  }
  const empPlans = typeof p.empreinte_scene === 'string' && EMPREINTE.test(p.empreinte_scene) ? p.empreinte_scene : null;
  const empImage = typeof resultatExtension.empreinte_scene === 'string' && EMPREINTE.test(resultatExtension.empreinte_scene) ? resultatExtension.empreinte_scene : null;
  if (!empPlans || !empImage) return { etat: 'indisponibles', raison: 'Les plans ne portent pas l’identifiant du modèle de l’image : ils ne sont pas proposés.' };
  if (empPlans !== empImage) return { etat: 'indisponibles', raison: 'Les plans ne correspondent pas au modèle de l’image : ils ne sont pas proposés.' };
  const planches = (Array.isArray(p.planches) ? p.planches : []).flatMap((x): PlancheLue[] => {
    if (!estObj(x)) return [];
    const numero = txt(x.numero, 12), titre = txt(x.titre, 120);
    return numero && titre ? [{ numero, titre, echelle: txt(x.echelle, 12) ?? '', format: txt(x.format, 24) ?? '' }] : [];
  }).slice(0, 20);
  const lignes = (v: unknown, n: number): string[] => (Array.isArray(v) ? v : []).map((s) => txt(s, 240)).filter((s): s is string => !!s).slice(0, n);
  return {
    etat: 'disponibles', pdfPath, dxfPath: chemin(p.dxf_path), apercuPath: chemin(p.apercu_path),
    modele: empPlans.slice(0, 12), planches, statuts: lignes(p.statuts, 8), avertissements: lignes(p.avertissements, 6),
    cout: nombre(p.jetons) === 0 ? COUT_PLANS_TEXTE : txt(p.cout) ?? COUT_PLANS_TEXTE,
    mention: txt(p.mention) ?? MENTION_PLANS,
  };
}

/** Une ligne par planche : « PL-01 Plan de masse — 1/200 ». Pur. */
export function lignesPlanches(v: Extract<VuePlansExtension, { etat: 'disponibles' }>): string[] {
  return v.planches.map((p) => `${p.numero} ${p.titre}${p.echelle ? ` — ${p.echelle}` : ''}`);
}

/**
 * Ce que l'outil `studio_etat_rendu` dit au modèle de langage (il ne recopie rien : la carte affiche les plans).
 * null : rien à dire (pas de bloc de plans). Pur.
 */
export function plansPourModele(resultat: unknown): { data: Obj; phrase: string } | null {
  const r = estObj(resultat) ? resultat : {};
  const lu = plansDuTravail({ resultat_extension: r.extension, resultat_maison: r.maison });
  if (!lu) return null;
  const v = lu.vue;
  const de = lu.genre === 'maison' ? 'de la maison' : 'de l’extension';
  if (v.etat === 'disponibles') {
    return {
      data: { disponibles: true, modele: v.modele, planches: lignesPlanches(v), jetons: 0 },
      phrase: ` Les plans ${de} (PDF et DXF, modèle ${v.modele}, le même que celui de l’image) sont prêts : la carte du chat propose leur téléchargement ; ne recopie ni les liens ni les cotes, et précise qu’ils sont indicatifs.`,
    };
  }
  return {
    data: { disponibles: false, raison: v.raison },
    phrase: ` Les plans ${de} ne sont pas disponibles (${v.raison}) : ne promets aucun plan ni PDF.`,
  };
}
