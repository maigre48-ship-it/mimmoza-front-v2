// src/lib/studio/manifesteVisite.ts
//
// MANIFESTE D'UNE VISITE 360° (version 1) — contrat CONTRAT_FILM_VISITE.md.
//
// Fichier `visites/<visite_id>/manifest.json`, écrit par le Studio, lu par la
// page publique /visite/:visiteId. Les chemins d'images sont relatifs au
// dossier de la visite (`pano-sejour.jpg` → `visites/<visite_id>/pano-sejour.jpg`).
// Module PUR (aucun import de Supabase) : testable avec node:test et
// réutilisable par le visualiseur.

/** Élément retiré du rendu faute d'asset certifié photoréaliste. */
export interface ElementOmis {
  /** Ex. « voitures », « personnes », « mobilier urbain ». */
  categorie: string;
  /** Ex. « aucun asset photoréaliste installé ». */
  raison: string;
}

/** Repère cliquable d'un panorama vers un autre. */
export interface LienPanorama {
  /** Identifiant du panorama de destination. */
  vers: string;
  /** Cap horizontal du repère, en degrés (0 = cap initial du panorama, sens horaire). */
  cap_deg: number;
  /** Inclinaison verticale du repère, en degrés (négatif = vers le sol). */
  inclinaison_deg: number;
  libelle?: string;
}

export interface PanoramaVisite {
  id: string;
  titre: string;
  /** Image équirectangulaire 2:1, relative au dossier de la visite. */
  image: string;
  largeur: number;
  hauteur: number;
  cap_initial_deg: number;
  niveau: number;
  /** Position dans la scène, en mètres [x, y, z]. */
  position_m: [number, number, number];
  liens: LienPanorama[];
}

export interface PlanVisite {
  image: string;
  niveaux: number[];
}

export interface ManifesteVisite {
  version: 1;
  titre: string;
  /** Identifiant du panorama de départ. */
  depart: string;
  panoramas: PanoramaVisite[];
  plan?: PlanVisite | null;
  mentions: string[];
  elements_omis: ElementOmis[];
}

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nombre = (v: unknown, defaut: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : defaut);
const texte = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Chemin relatif sûr : pas de « .. », pas d'adresse absolue, pas de schéma. */
export function cheminRelatifSur(chemin: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(chemin) && !chemin.startsWith('/') && !chemin.split(/[\\/]/).includes('..');
}

/** Lit une liste `{categorie, raison}` ; ignore les entrées mal formées. */
export function lireElementsOmis(brut: unknown): ElementOmis[] {
  if (!Array.isArray(brut)) return [];
  const vus = new Set<string>();
  const liste: ElementOmis[] = [];
  for (const e of brut) {
    const categorie = estObjet(e) ? texte(e.categorie) : texte(e);
    if (!categorie) continue;
    const raison = (estObjet(e) ? texte(e.raison) : null) ?? 'aucun asset photoréaliste disponible';
    const cle = categorie.toLowerCase();
    if (vus.has(cle)) continue;
    vus.add(cle);
    liste.push({ categorie, raison });
  }
  return liste;
}

/**
 * Valide un manifeste lu depuis le stockage. Renvoie `null` si inutilisable
 * (version inconnue, aucun panorama valide). Les liens vers un panorama
 * inexistant sont retirés ; un départ inconnu est remplacé par le premier.
 */
export function lireManifesteVisite(brut: unknown): ManifesteVisite | null {
  if (!estObjet(brut) || brut.version !== 1 || !Array.isArray(brut.panoramas)) return null;
  const panoramas: PanoramaVisite[] = [];
  for (const p of brut.panoramas) {
    if (!estObjet(p)) continue;
    const id = texte(p.id);
    const image = texte(p.image);
    if (!id || !image || !cheminRelatifSur(image) || panoramas.some(x => x.id === id)) continue;
    const pos = Array.isArray(p.position_m) ? p.position_m : [];
    panoramas.push({
      id,
      titre: texte(p.titre) ?? id,
      image,
      largeur: nombre(p.largeur, 0),
      hauteur: nombre(p.hauteur, 0),
      cap_initial_deg: nombre(p.cap_initial_deg, 0),
      niveau: Math.trunc(nombre(p.niveau, 0)),
      position_m: [nombre(pos[0], 0), nombre(pos[1], 0), nombre(pos[2], 0)],
      liens: Array.isArray(p.liens) ? p.liens.flatMap((l): LienPanorama[] => {
        if (!estObjet(l)) return [];
        const vers = texte(l.vers);
        if (!vers) return [];
        const libelle = texte(l.libelle);
        return [{ vers, cap_deg: nombre(l.cap_deg, 0), inclinaison_deg: nombre(l.inclinaison_deg, 0), ...(libelle ? { libelle } : {}) }];
      }) : [],
    });
  }
  if (!panoramas.length) return null;
  const ids = new Set(panoramas.map(p => p.id));
  for (const p of panoramas) p.liens = p.liens.filter(l => ids.has(l.vers) && l.vers !== p.id);
  const departDemande = texte(brut.depart);
  const plan = estObjet(brut.plan) && texte(brut.plan.image) && cheminRelatifSur(String(brut.plan.image))
    ? { image: String(brut.plan.image).trim(), niveaux: Array.isArray(brut.plan.niveaux) ? brut.plan.niveaux.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)) : [] }
    : null;
  return {
    version: 1,
    titre: texte(brut.titre) ?? 'Visite virtuelle',
    depart: departDemande && ids.has(departDemande) ? departDemande : panoramas[0].id,
    panoramas,
    plan,
    mentions: Array.isArray(brut.mentions) ? brut.mentions.map(texte).filter((m): m is string => Boolean(m)) : [],
    elements_omis: lireElementsOmis(brut.elements_omis),
  };
}
