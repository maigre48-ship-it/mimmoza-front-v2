// supabase/functions/copilot-chat/agent/maison-neuve.ts
// =============================================================
// LOT G10b (18/11/2026) — Mimmo et la MAISON NEUVE sur un terrain (côté site).
//
// Un outil, `maison_neuve`, appelé par le serveur (tour imposé) dès qu'une demande de construction de maison est
// détectée ou qu'une réponse au parcours arrive. Comme `extension_maison` : AUCUNE valeur ne vient du modèle. La
// parcelle vient de la référence donnée, de la photo du terrain (position EXIF) ou du tour précédent ; les réponses
// viennent du message REÇU ; l'état vient des sorties précédentes de l'outil (copilot_tool_calls de la conversation).
// Calcul PUR dans _shared/maisonNeuve (questions, gabarit placé avec reculs mesurés, autorisation indicative) ;
// projet transmis à la machine de rendu par le contrat contratMaison.ts (`fiche.projet_maison`).
// Lectures réseau (lecture seule, délais bornés, jamais bloquantes) : cadastre (API Carto IGN), parcelles voisines
// (limite sur rue), BD TOPO (bâtiment déjà présent sur le terrain), secteur protégé (services internes).
// =============================================================

import type { Donnee } from '../../_shared/extension/contrat.ts';
import {
  anneauParcelle, batimentsSurParcelle, contourEnLambert93, origineParcelle, telechargerBatimentsParcelle, versRepere,
} from '../../_shared/extension/bdtopoParcelle.ts';
import { lambert93VersWgs84, wgs84VersLambert93 } from '../../_shared/extension/lambert93.ts';
import { reglesMoteur } from '../../_shared/extension/parcours.ts';
import { candidatChoisi, candidatsCoteRue, type CandidatCoteRue } from '../../_shared/extension/coteRue.ts';
import type { CategorieLimite, ParcelleMaison } from '../../_shared/maisonNeuve/gabaritMaison.ts';
import { detecterIntentionMaisonNeuve, normaliser } from '../../_shared/maisonNeuve/instructionsMaison.ts';
import {
  avancerParcoursMaison, blocChoixMaison, ETAT_INITIAL, OUTIL_MAISON_NEUVE, suiteDuParcoursMaison,
  type EtatMaison, type QuestionMaison, type SortieMaison,
} from '../../_shared/maisonNeuve/parcoursMaison.ts';
import { lignesHabillage, lireCouverture, projetMaisonDepuisGabarit } from '../../_shared/maisonNeuve/projetMaison.ts';
import { lireProjetMaison, type CouvertureMaison, type ProjetMaison } from '../../_shared/maisonNeuve/contratMaison.ts';
import { chercherVoisinesParcelle, facadesVoieDeLaParcelle, type FacadeVoieFiche } from './voisines-parcelle.ts';
import { consulterSecteurProtege, facadesParVoisines, lireFacadesLues, reglesDeLaConception, urlCadastre, type ConceptionExtension, type DepotExtension, type FacadesVoieLues, type ServicesPatrimoine } from './extension.ts';
import { parcelleDepuisPhoto, photoProjetDesSorties, pointDansContour, recevoirPhoto, type DepotPhotoProjet, type PhotoDuTour, type PhotoProjet } from './photo-projet.ts';
import { chercherContourParcelle } from './conception.ts';
import type { OutilDef, ResultatOutil } from './types.ts';

export { detecterIntentionMaisonNeuve, OUTIL_MAISON_NEUVE, suiteDuParcoursMaison };

export const SOURCE_MAISON_NEUVE = 'MimmozIA · Maison neuve';
export const DELAI_SOURCE_MS = 10_000;
export const ETATS_RELUS_MAX = 10;
/** Question « côté de la rue » propre au parcours de maison (préfixe mn_ : reconnu par suiteDuParcoursMaison). */
export const Q_COTE_RUE = { id: 'mn_cote_rue', libelle: 'Côté de la rue' } as const;

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_IDU = /^(2[AB]\d{3}|\d{5})\d{3}[0-9A-Z]{2}\d{4}$/;

export const OUTIL_MAISON_NEUVE_DEF: OutilDef = {
  name: OUTIL_MAISON_NEUVE,
  description:
    "Parcours MAISON NEUVE (construire une maison individuelle sur un terrain, à partir d'une photo du terrain et/ou " +
    "d'instructions) : pose les questions qui manquent (surface habitable, niveaux, toit, style, menuiseries), place la " +
    "maison sur la parcelle en respectant les reculs (règles lues, sinon SUPPOSÉES et dites) et donne l'autorisation " +
    "INDICATIVE (permis de construire, architecte). L'application lit elle-même les réponses de l'utilisateur et affiche " +
    "le texte et les questions : n'écris aucun chiffre, ne pose aucune question à sa place ; écris seulement la phrase de " +
    "relance rendue. À appeler à chaque message du parcours.",
  input_schema: {
    type: 'object',
    properties: {
      conception_id: { type: 'string', description: 'Identifiant (uuid) de la conception de la parcelle, si connu.' },
      idu: { type: 'string', description: 'Identifiant cadastral (14 caractères) du terrain, si l’utilisateur l’a donné.' },
    },
  },
  available_in_modes: ['quick', 'advanced', 'report'],
};

/** Consigne ajoutée au prompt système quand le parcours est demandé ou en cours. */
export const CONSIGNE_MAISON_NEUVE = [
  '# MAISON NEUVE — PARCOURS GUIDÉ',
  `Appelle \`${OUTIL_MAISON_NEUVE}\` (sans inventer de paramètre ; \`idu\` seulement si l’utilisateur a donné la référence du terrain).`,
  '- Le texte, les verdicts et les questions à choix sont DÉJÀ affichés par l’application : écris ensuite EXACTEMENT la phrase de relance donnée par le résultat de l’outil, et rien d’autre (aucun chiffre, aucune question reposée, aucun bloc mimmoza-choix).',
  '- Ne parle jamais du « serveur », de « la fiche », du « moteur », d’un outil, d’un lot ou d’un nom technique.',
  '- N’annonce un résultat (maison placée, autorisation, image, plans) que s’il figure dans la sortie de l’outil de CE tour.',
  '- Ne calcule rien, ne place rien, n’affirme aucune conformité : l’autorisation est INDICATIVE et se vérifie en mairie.',
  '- Une maison neuve n’est JAMAIS un immeuble : n’appelle pas studio_preparer_3d pour ce projet.',
].join('\n');

// ── Accès aux données (injecté) ─────────────────────────────────────────────────────────────────────────────
export interface DepotMaison {
  conception(userId: string, q: { id?: string | null; idu?: string | null }): Promise<ConceptionExtension | null>;
  /** Sorties `data` des appels précédents de l'outil `maison_neuve` dans la conversation (du plus récent au plus ancien). */
  sortiesPrecedentes(userId: string, conversationId: string): Promise<Obj[]>;
  creerDossierParcelle?(userId: string, d: { idu: string; commune: string | null; parcelle: Obj }): Promise<string | null>;
}

export interface EnvMaison {
  userId: string | null;
  conversationId: string | null;
  texteUtilisateur: string;
  depot: DepotMaison;
  fetch: typeof fetch;
  maintenant?: () => number;
  patrimoine?: ServicesPatrimoine | null;
  photoDuTour?: PhotoDuTour | null;
  depotPhoto?: DepotPhotoProjet | null;
}

function erreur(message: string, status = 'error'): ResultatOutil {
  return { status, source: SOURCE_MAISON_NEUVE, message };
}

async function lireJson(f: typeof fetch, url: string, delaiMs = DELAI_SOURCE_MS): Promise<{ ok: true; data: unknown } | { ok: false; raison: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), delaiMs);
  try {
    const r = await f(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) return { ok: false, raison: `HTTP ${r.status}` };
    return { ok: true, data: await r.json() };
  } catch (e) {
    return { ok: false, raison: e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120) };
  } finally {
    clearTimeout(t);
  }
}

// ── Relecture de l'état ─────────────────────────────────────────────────────────────────────────────────────
/** État du parcours relu (revalidé champ par champ : une sortie mal formée vaut l'état initial). Pur. */
export function lireEtatMaison(v: unknown): EtatMaison {
  if (!estObj(v) || v.v !== 1 || !estObj(v.demande)) return ETAT_INITIAL;
  const d = v.demande;
  const don = <T,>(x: unknown, ok: (y: unknown) => y is T): Donnee<T> | undefined =>
    estObj(x) && ok(x.valeur) && ['mesuree', 'estimee', 'supposee', 'confirmee'].includes(x.statut as string) && typeof x.source === 'string'
      ? { valeur: x.valeur, statut: x.statut as Donnee<T>['statut'], source: x.source.slice(0, 200) } : undefined;
  const surface = don(d.surfaceHabitableM2, (y): y is number => typeof y === 'number' && y >= 30 && y <= 400);
  const niveaux = don(d.niveaux, (y): y is 1 | 2 => y === 1 || y === 2);
  const toit = don(d.toit, (y): y is 'deux-pans' | 'quatre-pans' | 'plat' | 'monopente' => y === 'deux-pans' || y === 'quatre-pans' || y === 'plat' || y === 'monopente');
  const style = don(d.style, (y): y is 'traditionnel' | 'contemporain' => y === 'traditionnel' || y === 'contemporain');
  const menuiseries = don(d.menuiseries, (y): y is 'anthracite' | 'blanc' | 'bois' => y === 'anthracite' || y === 'blanc' || y === 'bois');
  return {
    v: 1,
    demande: { ...(surface ? { surfaceHabitableM2: surface } : {}), ...(niveaux ? { niveaux } : {}), ...(toit ? { toit } : {}), ...(style ? { style } : {}), ...(menuiseries ? { menuiseries } : {}) },
    posees: Array.isArray(v.posees) ? v.posees.filter((x): x is string => typeof x === 'string' && /^mn_[a-z_]{1,30}$/.test(x)).slice(0, 12) : [],
    niveauxPlafonnes: v.niveauxPlafonnes === true,
  };
}

export interface PrecedentMaison {
  readonly etat: EtatMaison;
  readonly attendues: string[];
  readonly idu: string | null;
  readonly couverture: Donnee<CouvertureMaison> | null;
}

/** Dernier état du parcours, questions posées, terrain et couverture dite, relus dans les sorties précédentes. Pur. */
export function precedentMaison(sorties: readonly Obj[]): PrecedentMaison {
  let couverture: Donnee<CouvertureMaison> | null = null;
  for (const d of sorties) {
    if (!couverture && estObj(d) && estObj(d.couverture) && ['tuiles', 'ardoise', 'zinc'].includes(d.couverture.valeur as string) && typeof d.couverture.source === 'string') {
      couverture = { valeur: d.couverture.valeur as CouvertureMaison, statut: 'confirmee', source: d.couverture.source.slice(0, 200) };
    }
  }
  for (const d of sorties) {
    if (estObj(d) && estObj(d.etat)) {
      return {
        etat: lireEtatMaison(d.etat),
        attendues: Array.isArray(d.attendues) ? d.attendues.filter((x): x is string => typeof x === 'string').slice(0, 8) : [],
        idu: typeof d.idu === 'string' && RE_IDU.test(d.idu) ? d.idu : null,
        couverture,
      };
    }
  }
  return { etat: ETAT_INITIAL, attendues: [], idu: null, couverture };
}

/** Dernier projet de maison VALIDE de la conversation (contrat contratMaison.ts). Pur. */
export function projetMaisonDesSorties(sorties: readonly Obj[]): ProjetMaison | null {
  for (const d of sorties) {
    if (!estObj(d)) continue;
    // Un tour plus récent sans projet (parcours repris, refus) annule le projet précédent.
    if (estObj(d.etat) && (d.projet_maison === undefined || d.projet_maison === null)) return null;
    if (d.projet_maison === undefined || d.projet_maison === null) continue;
    const lu = lireProjetMaison(d.projet_maison);
    return lu.ok ? lu.projet : null;
  }
  return null;
}

function facadesLuesDesSorties(sorties: readonly Obj[], idu: string): FacadesVoieLues | null {
  for (const d of sorties) {
    if (!estObj(d) || d.facades_voie_lues === undefined) continue;
    const l = lireFacadesLues(d.facades_voie_lues);
    if (l && l.idu === idu) return l;
  }
  return null;
}

/** Valeur d'une puce « Libellé : option » dans le message reçu. Pur. */
function valeurDe(texte: string, libelle: string): string | null {
  const l = normaliser(libelle);
  for (const s of (texte ?? '').split(/[·\n;]/)) {
    const i = s.indexOf(':');
    if (i >= 0 && normaliser(s.slice(0, i)) === l) return s.slice(i + 1).trim();
  }
  return null;
}

/** Parcelle dans le repère de calcul, limites « voie » repérées par les façades sur voie (WGS 84), les autres classées. Pur. */
export function parcelleMaison(contourL93: readonly (readonly [number, number])[], origine: readonly [number, number], facades: readonly { debut: readonly [number, number]; fin: readonly [number, number] }[], surfaceM2: number | null): ParcelleMaison {
  const contour = contourL93.map((p) => versRepere([p[0], p[1]], [origine[0], origine[1]]));
  const segs = facades.map((f) => {
    const a = wgs84VersLambert93(f.debut[0], f.debut[1]);
    const b = wgs84VersLambert93(f.fin[0], f.fin[1]);
    return [versRepere(a, [origine[0], origine[1]]), versRepere(b, [origine[0], origine[1]])] as const;
  });
  const dist = (p: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }): number => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
  };
  const n = contour.length;
  const voie = contour.map((p, i) => {
    const q = contour[(i + 1) % n]!;
    return segs.some(([a, b]) => dist(p, a, b) <= 1 && dist(q, a, b) <= 1 && Math.hypot(q.x - p.x, q.z - p.z) > 0.2);
  });
  // Limite opposée à la rue = fond (arête dont la direction est la plus parallèle aux limites sur rue et la plus éloignée) ;
  // les autres sont séparatives. Sans limite sur rue : rien n'est classé (le gabarit refuse et le dit).
  const categories: (CategorieLimite | null)[] = contour.map(() => null);
  const iVoie = voie.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  if (iVoie.length) {
    for (const i of iVoie) categories[i] = 'voie';
    const milieu = (i: number) => { const a = contour[i]!, b = contour[(i + 1) % n]!; return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }; };
    const mv = iVoie.map(milieu);
    const cv = { x: mv.reduce((s, p) => s + p.x, 0) / mv.length, z: mv.reduce((s, p) => s + p.z, 0) / mv.length };
    let fond = -1, dmax = -1;
    for (let i = 0; i < n; i += 1) {
      if (voie[i]) continue;
      const a = contour[i]!, b = contour[(i + 1) % n]!;
      if (Math.hypot(b.x - a.x, b.z - a.z) < 0.5) continue;
      const m = milieu(i);
      const d = Math.hypot(m.x - cv.x, m.z - cv.z);
      if (d > dmax) { dmax = d; fond = i; }
    }
    for (let i = 0; i < n; i += 1) if (!voie[i]) categories[i] = i === fond ? 'fond' : 'separative';
  }
  const aire = Math.abs(contour.reduce((s, p, i) => { const q = contour[(i + 1) % n]!; return s + p.x * q.z - q.x * p.z; }, 0) / 2);
  return { contour, categories, surfaceM2: surfaceM2 && surfaceM2 > 0 ? surfaceM2 : Math.round(aire) };
}

/** Phrase de relance EXACTE (une par étape), sans chiffre ni nom interne. Pur. */
export function relanceMaison(s: Pick<SortieMaison, 'etape' | 'gabarit'>, o: { readonly coteRue?: boolean; readonly photo?: boolean } = {}): string {
  if (o.coteRue) return 'Indiquez-moi de quel côté du terrain se trouve la rue, avec le choix ci-dessous, et je place la maison.';
  switch (s.etape) {
    case 'programme': return 'Choisissez ci-dessous ce qui manque pour dessiner votre maison.';
    case 'sans_parcelle': return o.photo ? 'J’ai bien votre photo. Donnez-moi l’adresse ou la référence cadastrale du terrain, et je place la maison.' : 'Donnez-moi l’adresse ou la référence cadastrale du terrain, et je place la maison.';
    case 'refus': return s.gabarit?.propositions.length ? 'La maison demandée ne tient pas sur le terrain : choisissez ci-dessous une version qui tient.' : 'La maison ne tient pas sur le terrain avec les règles connues, pour les raisons ci-dessus.';
    case 'termine': return o.photo
      ? 'Votre maison est placée sur le terrain. Si vous le souhaitez, je prépare maintenant son image sur votre photo du terrain, avec ses plans.'
      : 'Votre maison est placée sur le terrain. Si vous le souhaitez, je prépare son image sur une photo du terrain (envoyez-la, ou je cherche celle de la rue), avec ses plans.';
  }
}

// ── Exécution ───────────────────────────────────────────────────────────────────────────────────────────────
export async function executerOutilMaisonNeuve(input: Obj, env: EnvMaison): Promise<ResultatOutil> {
  if (!env.userId) return erreur("Session requise : l'utilisateur n'est pas authentifié.");
  if (!env.conversationId) return erreur('Ouvrez d’abord une conversation : le projet de maison y est rattaché.');
  let sorties: Obj[] = [];
  try { sorties = await env.depot.sortiesPrecedentes(env.userId, env.conversationId); } catch { sorties = []; }
  const prec = precedentMaison(sorties);
  const dateJour = new Date((env.maintenant ?? Date.now)()).toISOString().slice(0, 10);
  const texte = env.texteUtilisateur ?? '';

  // Photo du terrain jointe à CE message (EXIF + dépôt privé), sinon celle d'un tour précédent.
  const photoPrecedente = photoProjetDesSorties(sorties);
  const recue = env.photoDuTour ? await recevoirPhoto(env.photoDuTour, env.userId, env.depotPhoto, dateJour, prec.idu) : null;
  let photo: PhotoProjet | null = recue?.photo ?? photoPrecedente;
  const lignes: string[] = [];
  if (recue?.raison) lignes.push(`Votre photo n’a pas pu être gardée pour l’image : ${recue.raison}.`);
  if (recue?.photo) lignes.push(`Votre photo${recue.photo.nom ? ` « ${recue.photo.nom} »` : ''} servira de fond à l’image de la maison (conservée dans votre espace privé, utilisée seulement pour vos rendus ; visages et plaques ne sont pas floutés).`);

  // Couverture dite (tuiles, ardoise, zinc) : message reçu, sinon tour précédent.
  const couvDite = lireCouverture(texte);
  const couverture: Donnee<CouvertureMaison> | null = couvDite ? { valeur: couvDite, statut: 'confirmee', source: 'dite par vous' } : prec.couverture;

  // Terrain : référence donnée, sinon celle du parcours, sinon la position de la photo.
  const iduDonne = typeof input.idu === 'string' ? input.idu.replace(/\s/g, '').toUpperCase() : null;
  let idu = iduDonne && RE_IDU.test(iduDonne) ? iduDonne : prec.idu;
  let geometrie: unknown = null;
  let surface: number | null = null;
  if (!idu && recue?.photo?.position) {
    const r = await parcelleDepuisPhoto(recue.photo.position, recue.photo.cap_deg, env.fetch);
    if ('parcelle' in r) { idu = r.parcelle.idu; geometrie = r.parcelle.geometrie; surface = r.parcelle.surfaceM2; lignes.push(`Terrain ${r.parcelle.idu} retrouvé d’après la ${r.parcelle.methode}. Si ce n’est pas le bon, donnez-moi son adresse.`); }
    else lignes.push(`Je n’ai pas pu retrouver le terrain d’après la photo : ${'raison' in r ? r.raison : 'position illisible'}.`);
  }
  let c: ConceptionExtension | null = null;
  try {
    if (typeof input.conception_id === 'string' && RE_UUID.test(input.conception_id)) c = await env.depot.conception(env.userId, { id: input.conception_id });
    if (!c && idu) c = await env.depot.conception(env.userId, { idu });
  } catch { c = null; }
  const iduRetenu = c?.idu ?? idu;
  if (photo && iduRetenu && photo.idu !== iduRetenu) photo = { ...photo, idu: iduRetenu };

  // Contour cadastral.
  if (estObj(c?.parcelle)) {
    geometrie = (c!.parcelle as Obj).geometrie ?? geometrie;
    if (typeof (c!.parcelle as Obj).surface_m2 === 'number') surface = (c!.parcelle as Obj).surface_m2 as number;
  }
  if (!geometrie && iduRetenu) {
    const r = await lireJson(env.fetch, urlCadastre(iduRetenu));
    const f = 'data' in r && estObj(r.data) && Array.isArray(r.data.features) ? r.data.features[0] : null;
    if (estObj(f)) { geometrie = f.geometry; if (estObj(f.properties) && typeof f.properties.contenance === 'number') surface = f.properties.contenance; }
    else lignes.push(`Le cadastre n’a pas répondu pour le terrain ${iduRetenu} : réessayez dans un instant.`);
  }
  const anneau = iduRetenu ? anneauParcelle(geometrie) : null;
  if (photo && photo.position && photo.depuis_terrain === null && anneau) photo = { ...photo, depuis_terrain: pointDansContour(photo.position, anneau) };

  // Limite sur rue : dossier de la parcelle, sinon mémorisée, sinon lue au cadastre (parcelles voisines), sinon demandée.
  let facades: FacadeVoieFiche[] = c ? facadesVoieDeLaParcelle(c.parcelle).facades : [];
  let sourceRue: string | null = facades.length ? 'limite sur rue déduite du cadastre et des parcelles voisines (dossier de la parcelle)' : null;
  let facadesLues: FacadesVoieLues | null = null;
  let raisonRue: string | null = null;
  let questionRue: { candidats: CandidatCoteRue[] } | null = null;
  if (!facades.length && anneau && iduRetenu) {
    const memo = facadesLuesDesSorties(sorties, iduRetenu);
    if (memo) { facadesLues = memo; facades = [...memo.facades]; }
    else {
      const lu = await facadesParVoisines(iduRetenu, geometrie, env.fetch);
      if (lu.facades.length) { facadesLues = { idu: iduRetenu, date: dateJour, facades: lu.facades }; facades = lu.facades; }
      else raisonRue = lu.raison;
    }
    if (facadesLues) sourceRue = `limite sur rue déduite du cadastre et des parcelles voisines (API Carto IGN, lue le ${facadesLues.date})`;
  }
  let facadesDesignees: { debut: readonly [number, number]; fin: readonly [number, number] }[] = [];
  if (!facades.length && anneau) {
    const candidats = candidatsCoteRue(anneau);
    const choisi = candidatChoisi(candidats, valeurDe(texte, Q_COTE_RUE.libelle));
    const memo = !choisi ? sorties.find((d) => estObj(d) && Array.isArray(d.cote_rue_designe)) : undefined;
    if (choisi) facadesDesignees = choisi.segments.map((s) => ({ debut: s.debut, fin: s.fin }));
    else if (memo && Array.isArray((memo as Obj).cote_rue_designe)) facadesDesignees = ((memo as Obj).cote_rue_designe as { debut: [number, number]; fin: [number, number] }[]).slice(0, 20);
    if (facadesDesignees.length) sourceRue = 'côté de la rue désigné par vous';
    else if (candidats.length) questionRue = { candidats };
  }
  const facadesRetenues = facades.length ? facades.map((f) => ({ debut: f.debut, fin: f.fin })) : facadesDesignees;

  // Bâtiment déjà présent sur le terrain (BD TOPO) et secteur protégé : lus, jamais bloquants.
  let secteurProtege: boolean | null = null;
  let parcelle: ParcelleMaison | null = null;
  let origine: [number, number] | null = null;
  let contourL93: ReturnType<typeof contourEnLambert93> = [];
  const reglesSite = reglesDeLaConception(c?.regles_plu);
  const rm = reglesMoteur(reglesSite);
  if (anneau && iduRetenu) {
    contourL93 = contourEnLambert93(anneau);
    origine = origineParcelle(contourL93) as [number, number];
    const [lonC, latC] = lambert93VersWgs84(origine[0], origine[1]);
    const [bd, sp] = await Promise.all([
      telechargerBatimentsParcelle(contourL93, env.fetch).catch(() => null),
      consulterSecteurProtege(iduRetenu, lonC, latC, env.patrimoine, dateJour).catch(() => null),
    ]);
    if (bd && bd.ok) {
      const sur = batimentsSurParcelle(bd.batiments, contourL93);
      if (sur.length) lignes.push(`Le terrain porte déjà ${sur.length > 1 ? `${sur.length} bâtiments` : 'un bâtiment'} d’après la base des bâtiments de l’IGN (BD TOPO, lue le ${dateJour}) : la maison neuve suppose ${sur.length > 1 ? 'leur' : 'sa'} démolition (permis de démolir possible). Pour agrandir une maison existante, dites « agrandir ma maison ».`);
    }
    secteurProtege = sp ? (sp.etat === 'oui' ? true : sp.etat === 'non_trouve' ? false : null) : null;
    if (sp) lignes.push(`Secteur protégé (indicatif) : ${sp.libelle}.`);
    if (facadesRetenues.length || !questionRue) parcelle = parcelleMaison(contourL93, origine, facadesRetenues, surface);
  }
  if (sourceRue) lignes.push(`Côté de la rue : ${sourceRue}.`);
  else if (anneau && !questionRue) lignes.push(`Côté de la rue : non identifié${raisonRue ? ` (${raisonRue.replace(/[.\s]+$/, '')})` : ''}.`);

  // Parcours (pur). Côté de la rue encore inconnu : les questions du programme d'abord, puis la rue.
  const ctx = { parcelle: questionRue ? null : parcelle, regles: rm.regles, secteurProtege };
  let s = avancerParcoursMaison(prec.etat, texte, ctx);
  let blocChoix = s.blocChoix;
  let attendues = [...s.attendues];
  let texteAffiche = s.texte;
  const demanderRue = !!questionRue && iduRetenu !== null && s.etape === 'sans_parcelle';
  if (demanderRue) {
    const q: QuestionMaison = { id: Q_COTE_RUE.id, libelle: Q_COTE_RUE.libelle, options: questionRue!.candidats.map((x) => x.libelle), multiple: false };
    blocChoix = blocChoixMaison([q]);
    attendues = [Q_COTE_RUE.id];
    texteAffiche = `**De quel côté du terrain se trouve la rue ?** Je n’ai pas pu la situer automatiquement${raisonRue ? ` (${raisonRue.replace(/[.\s]+$/, '')})` : ''}. Elle sert à placer la maison et à mesurer les reculs : choisissez le côté dans « ${Q_COTE_RUE.libelle} ».`;
    s = { ...s, etape: 'sans_parcelle' };
  }
  if (rm.lignes.length && (s.etape === 'termine' || s.etape === 'refus')) texteAffiche += `\n\n**Règles d’implantation utilisées :**\n${rm.lignes.map((l) => `- ${l}`).join('\n')}`;

  // Projet transmis à la machine de rendu (contrat), seulement si la maison est placée.
  let projet: ProjetMaison | null = null;
  if (s.etape === 'termine' && s.gabarit?.ok && s.gabarit.gabarit && s.autorisation && parcelle && origine && anneau && iduRetenu) {
    const p = projetMaisonDepuisGabarit({
      idu: iduRetenu, commune: c?.commune ?? null, date: dateJour, contourWgs84: anneau, surfaceM2: surface, origineL93: origine, parcelle,
      facadesVoie: facadesRetenues, gabarit: s.gabarit.gabarit, demande: s.etat.demande, couverture, autorisation: s.autorisation,
      hypotheses: s.gabarit.hypotheses,
    });
    if ('projet' in p) {
      projet = p.projet;
      texteAffiche += `\n\n**Habillage de l’image et des plans**\n${lignesHabillage(projet).map((l) => `- ${l}`).join('\n')}`;
    } else {
      texteAffiche += `\n\nLa maison est placée, mais son projet n’a pas pu être préparé pour l’image (${('erreurs' in p ? p.erreurs : []).slice(0, 2).join(' ; ')}).`;
    }
  }
  if (lignes.length) texteAffiche += `\n\n${lignes.map((l) => `- ${l}`).join('\n')}`;

  // Dossier minimal de la parcelle (contour et parcelles voisines du cadastre) si la maison est placée sans dossier.
  let dossierId: string | null = null;
  if (projet && !c && env.depot.creerDossierParcelle && iduRetenu) {
    try {
      const pc = await chercherContourParcelle(iduRetenu, env.fetch);
      if (pc) dossierId = await env.depot.creerDossierParcelle(env.userId, { idu: iduRetenu, commune: null, parcelle: pc as unknown as Obj });
    } catch { dossierId = null; }
  }

  const relance = relanceMaison(s, { coteRue: demanderRue, photo: photo !== null });
  return {
    status: 'ok', source: SOURCE_MAISON_NEUVE,
    data: {
      etape: demanderRue ? 'cote_rue' : s.etape, etat: s.etat, attendues, idu: iduRetenu,
      texte_affiche: texteAffiche, bloc_choix: blocChoix, phrase_relance: relance,
      ...(couverture ? { couverture } : {}),
      ...(projet ? { projet_maison: projet } : {}),
      ...(facadesLues ? { facades_voie_lues: facadesLues } : {}),
      ...(facadesDesignees.length ? { cote_rue_designe: facadesDesignees } : {}),
      ...(photo ? { photo_projet: photo } : {}),
      ...(dossierId ? { dossier_parcelle_id: dossierId } : {}),
    },
    message:
      'DÉJÀ AFFICHÉ À L’UTILISATEUR : le texte du parcours' + (blocChoix ? ' et les questions à choix (puces sous ta réponse). ' : '. ') +
      `Écris EXACTEMENT cette phrase, et rien d’autre : « ${relance} » ` +
      'N’ajoute aucun chiffre, aucune question, aucun bloc mimmoza-choix ; ne parle ni de « serveur », ni de « fiche », ni de « moteur » ; ' +
      'n’annonce aucun résultat qui ne figure pas dans cette sortie.' +
      (projet
        ? ' Si l’utilisateur accepte l’image (à un message SUIVANT) : appelle studio_lancer_rendu avec type « image », SANS brief et SANS appeler studio_preparer_3d ; l’image part de CETTE maison (jamais d’un immeuble ni de logements). Ne promets ni délai ni image : elle n’est montrée que si la maison est placée avec précision dans une vraie photo.'
        : ' La maison N’EST PAS (encore) placée : n’appelle aucun outil de 3D ni de rendu, et n’annonce aucune image ni aucun plan.'),
  };
}

// ── Supabase ────────────────────────────────────────────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
type ClientSb = any;

/** Lectures bornées à l'utilisateur ET à la conversation ; le dossier de parcelle passe par le dépôt de l'extension. */
export function depotMaisonSupabase(admin: ClientSb, extension: DepotExtension): DepotMaison {
  return {
    conception: (u, q) => extension.conception(u, q),
    ...(extension.creerDossierParcelle ? { creerDossierParcelle: (u: string, d: { idu: string; commune: string | null; parcelle: Obj }) => extension.creerDossierParcelle!(u, d) } : {}),
    async sortiesPrecedentes(userId, conversationId) {
      const { data, error } = await admin.from('copilot_tool_calls').select('tool_output')
        .eq('user_id', userId).eq('conversation_id', conversationId).eq('tool_name', OUTIL_MAISON_NEUVE)
        .order('created_at', { ascending: false }).limit(ETATS_RELUS_MAX);
      if (error || !Array.isArray(data)) return [];
      return data.flatMap((l: { tool_output?: { status?: unknown; data?: unknown } }) =>
        l.tool_output?.status === 'ok' && estObj(l.tool_output.data) ? [l.tool_output.data as Obj] : []);
    },
  };
}

/** Intention « maison neuve » au tour : demande explicite, ou photo jointe avec une demande de construction. Pur. */
export function intentionMaisonNeuve(texte: string): boolean {
  return detecterIntentionMaisonNeuve(texte);
}

export { chercherVoisinesParcelle };
