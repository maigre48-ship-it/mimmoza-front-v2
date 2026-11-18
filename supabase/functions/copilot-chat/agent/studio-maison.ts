// supabase/functions/copilot-chat/agent/studio-maison.ts
// =============================================================
// LOT G10b (18/11/2026) — IMAGE (et plans) d'une MAISON NEUVE placée dans le parcours `maison_neuve`.
//
// Appelé par studio.ts (studio_lancer_rendu) quand la conversation porte un projet de maison neuve PLACÉE (dernier
// parcours de la conversation). Aucune 3D préparée, aucun volume d'immeuble : la fiche du travail décrit LA maison du
// parcours (un bâtiment du contrat v2, pose exacte contrôlée par la machine de rendu) + `fiche.projet_maison`.
// Photoréaliste ou rien : le fond est TOUJOURS une vraie photo (celle du terrain envoyée dans la conversation, sinon
// la photo de la rue Panoramax / IGN) ; la machine de rendu ne montre aucune image si la maison n'est pas placée avec
// précision dans la photo (elle demande alors une photo du terrain).
// Devis puis accord (même jeton signé que les autres rendus, source « maison ») ; rien n'est lancé sans l'accord.
// =============================================================

import { batimentV2Maison, clausesMaison, menuiseriesStudio, type ProjetMaison } from '../../_shared/maisonNeuve/contratMaison.ts';
import { CLES_FOND, fondDe, LIBELLES_FOND } from '../../../../src/lib/studio/fondImage.ts';
import { construireProjetChat } from '../../../../src/spaces/copilot/studio3d/projetChat.ts';
import { validerProjet } from '../../../../src/spaces/promoteur/shared/echangeStudio/mimmozaProjetV2.ts';
import { optionPhotoClient, photoProjetDesSorties, photoProjetUtilisableCommeFond, type PhotoProjet } from './photo-projet.ts';
import { projetMaisonDesSorties } from './maison-neuve.ts';
import type { ResultatOutil } from './types.ts';
import type { BriefCarte, ChargeJeton, EnvStudio, TravailLu, Validation } from './studio.ts';

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export const SOURCE_STUDIO_MAISON = 'MimmozIA · Studio 3D';

/** Ce dont le rendu de maison a besoin dans studio.ts (injecté : aucun import circulaire de valeur). */
export interface OutilsStudio {
  validerOptionsRendu(type: unknown, brut: unknown, proprietaire: string | null): Validation<Obj>;
  signerJeton(charge: ChargeJeton, secret: string): Promise<string>;
  devisDeLaConversation(env: EnvStudio, uid: string, filtre: (c: ChargeJeton) => boolean, nonLance?: boolean): Promise<{ jeton: string; charge: ChargeJeton } | null>;
  etatMachine(stats: Awaited<ReturnType<EnvStudio['depot']['statsFile']>>, maintenant: number): { phrase: string };
  heureParis(ms: number): string;
  jsonCanonique(v: unknown): string;
  sha256Hex(s: string): Promise<string>;
  vueTravail(t: TravailLu): Obj;
  resumeOptions(type: 'image', o: Obj): string;
  messageEtatEnDirect: string;
  devisValiditeMs: number;
  nombreMaxTravauxActifs: number;
}

export interface MaisonConversation {
  readonly projet: ProjetMaison;
  readonly photo: PhotoProjet | null;
}

/**
 * Projet de maison neuve de la conversation, s'il est le DERNIER parcours de la conversation (un parcours d'extension
 * plus récent l'emporte). null sinon. Ne lève jamais.
 */
export async function maisonDeLaConversation(env: EnvStudio, uid: string): Promise<MaisonConversation | null> {
  const d = env.depot;
  if (!d.sortiesMaison || !env.conversationId) return null;
  try {
    if (d.dernierParcours && (await d.dernierParcours(uid, env.conversationId)) !== 'maison_neuve') return null;
    const sorties = await d.sortiesMaison(uid, env.conversationId);
    const projet = projetMaisonDesSorties(sorties);
    return projet ? { projet, photo: photoProjetDesSorties(sorties) } : null;
  } catch {
    return null;
  }
}

/** Empreinte du projet de maison (64 hex) : le devis décrit CE projet, rien d'autre. */
export async function empreinteProjetMaison(p: ProjetMaison, o: Pick<OutilsStudio, 'jsonCanonique' | 'sha256Hex'>): Promise<string> {
  return await o.sha256Hex(o.jsonCanonique({ v: 1, projet: p }));
}

export const MESSAGE_MAISON_SANS_3D =
  'RIEN N’A ÉTÉ PRÉPARÉ. Cette conversation porte un projet de MAISON NEUVE placée dans le parcours : il n’y a pas de 3D préparée à faire ' +
  '(ni volume, ni forme, ni logements). Si l’utilisateur veut l’image, appelle studio_lancer_rendu avec type « image », SANS brief ; ' +
  'sinon propose l’image de sa maison sur une photo du terrain, en une phrase.';

/** Consigne au modèle quand aucune image de maison neuve n'est montrée faute de vraie photo calée. */
export const MESSAGE_PHOTO_REQUISE_MAISON =
  'AUCUNE IMAGE n’est montrée : l’image d’une maison neuve n’est faite que sur une vraie photo du terrain, et la maison n’a pas pu y être placée avec précision. ' +
  'Dis-le en une phrase, puis demande une photo du terrain prise depuis la rue (en plein jour, sans zoom, avec au moins un angle du terrain et si possible une maison voisine), ' +
  'ou de placer le terrain sur la photo si la carte le propose. N’annonce ni ne décris aucune image, ne propose pas d’« image d’étude », et n’écris aucun nom d’outil, de logiciel ou de machine.';

const LIBELLE_TOIT: Readonly<Record<string, string>> = { 'deux-pans': 'toit à deux pans', 'quatre-pans': 'toit à quatre pans', plat: 'toit plat', monopente: 'toit monopente' };
const fr = (v: number, d = 1): string => (Math.round(v * 10 ** d) / 10 ** d).toString().replace('.', ',');

/** Titre du rendu (carte du chat). Pur. */
export function titreMaison(p: ProjetMaison): string {
  const m = p.maison;
  return `Maison neuve ${m.niveaux.valeur === 1 ? 'de plain-pied' : 'R+1'} — ${fr(m.longueurM)} × ${fr(m.largeurM)} m, ${LIBELLE_TOIT[m.toit.valeur] ?? m.toit.valeur} — ${p.idu}`.slice(0, 120);
}

/** Phrase de création lue par le Studio (même phrase que celle du worker, avec les clauses d'habillage). Pur. */
export function commandeMaison(p: ProjetMaison): string {
  const m = p.maison;
  const base = `Crée une maison ${m.niveaux.valeur <= 1 ? 'de plain-pied' : 'R+1'} de ${fr(m.longueurM, 2)} mètres sur ${fr(m.largeurM, 2)}`;
  return `${base}, ${clausesMaison(p).join(', ')}.`;
}

/**
 * Fiche `studio_jobs` de la maison : projet v2 (parcelle, bâtiment de la maison, limites sur rue) + projet de maison +
 * habillage (clauses de création et menuiseries). Pur (horodatage et identifiants fournis).
 */
export function ficheMaison(p: ProjetMaison, conversationId: string, horodatage: string, sessionId: string, origine: string): Validation<Obj> {
  const anneau = [...p.parcelle.contourWgs84.map((q) => [q[0], q[1]]), [p.parcelle.contourWgs84[0]![0], p.parcelle.contourWgs84[0]![1]]];
  const insee = /^\d{5}|^2[AB]\d{3}/.test(p.idu) ? p.idu.slice(0, 5) : null;
  const bat = batimentV2Maison(p);
  const construit = construireProjetChat({
    conversationId, etudeId: null, sessionId, origine, retourUrl: null, revision: 0, horodatage,
    parcelles: [{ id: p.idu, feature: { type: 'Feature', properties: { id: p.idu, ...(insee ? { code_insee: insee } : {}) }, geometry: { type: 'Polygon', coordinates: [anneau] } } }],
    communeInsee: insee, adresse: p.commune, pointAdresse: null, relief: null,
    implantation: { lon: bat.centre.lon, lat: bat.centre.lat, orientationDeg: bat.rotationDeg, entryOffsetM: 0 },
    brief: `Maison individuelle neuve du parcours Mimmoza (${titreMaison(p)}) : emprise, hauteurs et toit calculés, reculs mesurés.`,
    commandeArchitecture: commandeMaison(p),
  });
  if (!('projet' in construit)) return { ok: false, erreur: `Projet de maison refusé par le contrat v2 : ${'erreur' in construit ? construit.erreur : 'raison inconnue'}` };
  // Un bâtiment du contrat v2 : la machine de rendu le construit et contrôle sa pose (centre, orientation, dimensions,
  // niveaux, 5 cm) ; la commande et l'implantation uniques sont alors retirées par la machine de rendu.
  const lu = validerProjet({ ...construit.projet, batiments: [bat] });
  if (!lu.ok) return { ok: false, erreur: `Bâtiment de la maison refusé par le contrat v2 : ${'erreur' in lu ? lu.erreur : 'raison inconnue'}` };
  const charge = p.facadesVoie.length
    ? { ...lu.projet, site: { ...lu.projet.site, facadesVoie: p.facadesVoie.map((f) => ({ debut: [f.debut[0], f.debut[1]], fin: [f.fin[0], f.fin[1]] })) } }
    : lu.projet;
  const menuiseries = menuiseriesStudio(p);
  return {
    ok: true,
    valeur: {
      version: 1, charge, titre: titreMaison(p), conversation_id: conversationId, origine: 'mimmo',
      projet_maison: JSON.parse(JSON.stringify(p)),
      habillage_batiments: { clauses: clausesMaison(p), balcons: null, ...(menuiseries ? { details: { menuiseries } } : {}) },
    },
  };
}

/** Lignes du devis : ce qui est dessiné, ce qui reste estimé, et la règle « photo réelle ». Pur. */
export function avertissementsMaison(p: ProjetMaison, photo: PhotoProjet | null): string[] {
  const m = p.maison;
  const l = [
    `Maison neuve dessinée telle que placée dans le parcours : ${fr(m.longueurM, 2)} × ${fr(m.largeurM, 2)} m au sol, ${m.niveaux.valeur === 1 ? 'plain-pied' : 'R+1'}, ${LIBELLE_TOIT[m.toit.valeur] ?? m.toit.valeur} ; la machine de rendu vérifie sa position au centimètre près avant tout rendu.`,
    'Image seulement sur une VRAIE photo (la vôtre, sinon la photo de la rue Panoramax / IGN, Licence Ouverte) : si la maison ne peut pas être placée avec précision dans la photo, aucune image n’est montrée et une photo du terrain vous est demandée.',
    'Les plans (masse, niveaux avec cloisonnement indicatif, 4 façades, coupe) sont dessinés depuis le même modèle que l’image.',
    'Le relief n’est pas transmis : la machine de rendu calcule sur un terrain supposé plat.',
  ];
  if (!photo) l.unshift('Aucune photo du terrain dans la conversation : la photo de la rue sera essayée. Pour une image depuis votre point de vue, envoyez une photo du terrain prise depuis la rue.');
  if (p.habillage.menuiseries.valeur === 'bois') l.push('Menuiseries bois : pas encore disponibles dans l’image ; elles y seront anthracite (les plans ne portent pas de couleur).');
  return l;
}

/** FINITIONS 18/11 — rendu « image sur photo » refusé par la configuration : phrase SANS terme technique (le modèle la
 *  recopie souvent telle quelle). Le diagnostic précis (type de rendu non autorisé côté données) est dans le journal. */
const MESSAGE_IMAGE_PAS_OUVERTE = 'L’image de la maison sur une photo n’est pas encore ouverte sur Mimmoza. RIEN N’A ÉTÉ LANCÉ. Dis-le simplement à l’utilisateur, sans détail technique, et propose les plans de la maison, qui ne dépendent pas de l’image.';

function erreur(message: string, status = 'error'): ResultatOutil {
  return { status, source: SOURCE_STUDIO_MAISON, message };
}

/**
 * Temps 1 — DEVIS de l'image de la maison (rien n'est écrit). Fond : photo du terrain envoyée, sinon celle choisie dans la
 * carte, sinon la photo de la rue ; jamais « étude seule ».
 */
export async function devisRenduMaison(type: unknown, input: Obj, env: EnvStudio, m: MaisonConversation, carte: Validation<BriefCarte> | null, o: OutilsStudio): Promise<ResultatOutil> {
  if (!env.secret || !env.conversationId || !env.userId) return erreur('Rendus indisponibles pour cette conversation.', 'not_configured');
  if (type !== 'image') {
    return erreur('RIEN N’A ÉTÉ LANCÉ. Pour une maison neuve, seule l’IMAGE sur une vraie photo du terrain est proposée pour l’instant (pas de film ni de visite 360°). Propose l’image, en une phrase.', 'partial');
  }
  const uid = env.userId;
  const maintenant = (env.maintenant ?? Date.now)();
  // Fond : photo du terrain de la conversation > fond choisi dans la carte > photo de la rue. Jamais « étude ».
  const sansFond = Object.fromEntries(Object.entries(estObj(input.options) ? input.options : {}).filter(([k]) => !(CLES_FOND as readonly string[]).includes(k)));
  const fondCarte = carte?.ok && carte.valeur.fond ? carte.valeur.fond as Obj : null;
  let demande: Obj;
  let noteFond: string;
  if (fondCarte && fondDe(fondCarte) !== 'etude') { demande = { ...sansFond, ...fondCarte }; noteFond = 'Fond de l’image : celui que vous venez de choisir.'; }
  // FINITIONS 18/11 — la photo jointe ne sert de fond qu'avec l'accord prévu (ACCORD_PHOTO_JOINTE).
  else if (m.photo && photoProjetUtilisableCommeFond(m.photo)) { demande = { ...sansFond, fond: 'photo_client', photo_client: optionPhotoClient(m.photo) }; noteFond = 'Fond de l’image : la photo du terrain envoyée dans la conversation.'; }
  else { demande = { ...sansFond, fond: 'photo_rue' }; noteFond = 'Fond de l’image : la photo de la rue (Panoramax / IGN, Licence Ouverte), seule vraie photo disponible.'; }
  const opts = o.validerOptionsRendu('image', demande, uid);
  if (!('valeur' in opts)) return erreur(`${'erreur' in opts ? opts.erreur : 'Options refusées.'} RIEN N’A ÉTÉ LANCÉ.`);
  if (fondDe(opts.valeur) === 'etude') return erreur('RIEN N’A ÉTÉ LANCÉ. Une image de maison neuve ne se fait que sur une vraie photo du terrain : demande à l’utilisateur une photo prise depuis la rue.', 'partial');
  if ((await env.depot.typeRenduAutorise('image', opts.valeur)) === false) {
    return erreur(MESSAGE_IMAGE_PAS_OUVERTE, 'not_configured');
  }
  const actifs = await env.depot.travauxActifs(uid);
  if (actifs >= o.nombreMaxTravauxActifs) return erreur(`Vous avez déjà ${actifs} rendus en préparation (${o.nombreMaxTravauxActifs} au plus) : attendez qu’un se termine.`);
  const empreinte = await empreinteProjetMaison(m.projet, o);
  const source = { genre: 'maison' as const, idu: m.projet.idu, empreinte };
  const memeDevis = (c: ChargeJeton) => c.exp >= maintenant && c.rq !== env.requete && c.t === 'image'
    && o.jsonCanonique(c.o) === o.jsonCanonique(opts.valeur) && o.jsonCanonique(c.s) === o.jsonCanonique(source);
  const existant = await o.devisDeLaConversation(env, uid, memeDevis, true);
  const charge: ChargeJeton = existant?.charge ?? {
    v: 1, id: crypto.randomUUID(), u: uid, t: 'image', o: opts.valeur, s: source,
    c: env.conversationId, iat: maintenant, exp: maintenant + o.devisValiditeMs, rq: env.requete,
  };
  const stats = await env.depot.statsFile();
  const devis = {
    rendu: `Image du projet — ${o.resumeOptions('image', opts.valeur)}`,
    source: `maison neuve placée dans le parcours (${m.projet.idu})`,
    jetons: 0,
    cout_jetons: 'Aucun jeton débité pour ce rendu : les rendus ne sont pas facturés aujourd’hui (seul ce message du chat est compté, comme d’habitude).',
    calcul_gpu: 'Calcul sur la machine de rendu Mimmoza (carte graphique), un rendu à la fois ; aucun service payant externe.',
    duree: 'environ 30 min à 1 h 30 une fois le rendu démarré (préparation, placement dans la photo, rendu) — estimation, non mesurée pour ce projet',
    file_attente: stats ? `${stats.attente} rendu(s) en attente, ${stats.enCours} en cours` : 'inconnue',
    machine_de_rendu: o.etatMachine(stats, maintenant).phrase,
    fond: LIBELLES_FOND[fondDe(opts.valeur)],
    avertissements: [noteFond, ...avertissementsMaison(m.projet, m.photo)],
    valable_jusqu_a: `${o.heureParis(charge.exp)} (heure de Paris)`,
  };
  const jeton = existant?.jeton ?? await o.signerJeton(charge, env.secret);
  return {
    status: 'confirmation_requise', source: SOURCE_STUDIO_MAISON,
    data: { jeton_devis: jeton, confirmation_requise: true, ...(existant ? { deja_presente: true } : {}), type: 'image', options: opts.valeur, devis, maison_neuve: true },
    message: existant
      ? "RIEN N'A ÉTÉ LANCÉ. Ce devis a DÉJÀ été présenté et reste valable. Si le DERNIER message de l'utilisateur donne son accord, rappelle IMMÉDIATEMENT studio_lancer_rendu avec confirmer: true ; sinon rappelle brièvement le devis et attends sa réponse."
      : "RIEN N'A ÉTÉ LANCÉ. Ceci est un DEVIS pour l'image de la MAISON NEUVE du parcours. Présente-le (rendu, source, fond, jetons, temps de calcul, file, état de la machine de rendu, avertissements, heure limite) et demande l'accord. " +
        "Si l'utilisateur répond OUI dans son PROCHAIN message, rappelle studio_lancer_rendu avec confirmer: true. Ne promets aucune image : elle n'est montrée que si la maison est placée avec précision dans une vraie photo ; " +
        "ne parle ni d'immeuble, ni de logements, ni d'habillage à choisir.",
  };
}

/** Temps 2 — accord sur un devis de maison : la maison du devis doit être celle de la conversation (même empreinte). */
export async function confirmerRenduMaison(j: ChargeJeton, env: EnvStudio, o: OutilsStudio): Promise<ResultatOutil> {
  const uid = env.userId!;
  const s = j.s as { genre: 'maison'; idu: string; empreinte: string };
  const deja = await env.depot.travailParDevis(uid, j.id);
  if (deja) return { status: 'ok', source: SOURCE_STUDIO_MAISON, data: { deja_lance: true, ...o.vueTravail(deja) }, message: 'Ce devis a déjà été lancé : rien n’a été relancé.' + o.messageEtatEnDirect };
  const m = await maisonDeLaConversation(env, uid);
  if (!m || m.projet.idu !== s.idu || await empreinteProjetMaison(m.projet, o) !== s.empreinte) {
    return erreur('RIEN N’A ÉTÉ LANCÉ. Le projet de maison a changé depuis ce devis (ou n’est plus lisible) : rappelle l’outil SANS confirmer pour établir le devis de la maison actuelle, présente-le et attends l’accord.');
  }
  if ((await env.depot.typeRenduAutorise('image', j.o)) === false) return erreur(MESSAGE_IMAGE_PAS_OUVERTE, 'not_configured');
  const maintenant = (env.maintenant ?? Date.now)();
  const f = ficheMaison(m.projet, j.c, new Date(maintenant).toISOString(), crypto.randomUUID(), env.origine);
  if (!('valeur' in f)) return erreur(`${'erreur' in f ? f.erreur : 'Fiche refusée.'} RIEN N’A ÉTÉ LANCÉ.`);
  // FINITIONS 18/11 — devis des plans seuls : la machine de rendu ne produit que les plans (aucune image).
  const fiche: Obj = { ...f.valeur, devis_id: j.id, ...(j.ps ? { plans_seuls: true } : {}) };
  let t: TravailLu;
  try {
    t = await env.depot.insererTravail(uid, { conversation_id: j.c, type: 'image', fiche, options: j.o });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/studio_jobs_plafond/.test(msg)) return erreur(`Vous avez déjà ${o.nombreMaxTravauxActifs} rendus en préparation : attendez qu’un se termine. RIEN N’A ÉTÉ LANCÉ.`);
    return erreur(`Le lancement n’a pas abouti (${msg.slice(0, 200)}). RIEN N’A ÉTÉ LANCÉ.`);
  }
  const machine = o.etatMachine(await env.depot.statsFile(), maintenant);
  return {
    status: 'ok', source: SOURCE_STUDIO_MAISON,
    data: { lance: true, ...o.vueTravail(t), machine: machine.phrase, suivi: 'studio_etat_rendu (sans argument : le plus récent de la conversation)' },
    message: (j.ps ? 'Plans de la maison (SANS image) ENREGISTRÉS dans la file : n’annonce aucune image. ' : '') + 'Rendu de la maison ENREGISTRÉ dans la file. Dis qu’il est enregistré ; n’annonce aucun démarrage, délai ni image qui ne soit pas renvoyé. ' +
      'Le suivi, puis l’image (si la maison est placée avec précision dans la photo) et les plans, s’affichent dans une carte du chat sous ce message.' + o.messageEtatEnDirect,
  };
}
