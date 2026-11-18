// supabase/functions/copilot-chat/harnais/banc.ts
// HARNAIS DE BOUT EN BOUT DES PARCOURS DU CHAT (18/11/2026) — banc commun aux scénarios.
//
// Ce que le banc rejoue, tour par tour, comme le chat de production :
//   • l'AIGUILLAGE du tour (copilot-chat/index.ts, traiterTour) recopié avec les MÊMES prédicats exportés
//     (detecterIntentionExtension, reponseAuParcours, suiteDuParcours, demandeRetouche, intentionPhotoExtension,
//     messagePlanPourLeParcours, detecterIntentionMaisonNeuve, suiteDuParcoursMaison, studioPertinent) : tour IMPOSÉ
//     sur l'outil du parcours, outils Studio proposés ou non ;
//   • les VRAIS outils (executerOutilExtension, executerOutilMaisonNeuve, executerOutilStudio) ;
//   • un modèle de langage SIMULÉ et déterministe : il appelle l'outil imposé, recopie la phrase de relance quand l'outil
//     en donne une, et n'appelle un outil Studio que si le scénario le demande ET que le chat le lui propose ;
//   • ce que l'utilisateur VOIT : texte affiché par le serveur + texte du modèle + questions à choix (comme index.ts) ;
//   • la base (copilot_tool_calls, agent_conceptions, studio_preparations, studio_travaux, dépôt des photos) en mémoire ;
//   • le réseau (BD TOPO, cadastre, GPU, Panoramax) avec des réponses FIGÉES (données réelles des fixtures X3/G3/G7).
// Ce que le banc ne rejoue PAS : le serveur HTTP (Deno.serve, authentification, crédits, flux SSE), le vrai modèle de
// langage et sa rédaction libre, la machine de rendu (ses résultats sont posés par le scénario).
import { executerOutilExtension, OUTIL_EXTENSION_MAISON, reponseAuParcours, suiteDuParcours, detecterIntentionExtension, demandeRetouche, type DepotExtension } from '../agent/extension.ts';
import { executerOutilMaisonNeuve, OUTIL_MAISON_NEUVE, type DepotMaison } from '../agent/maison-neuve.ts';
import { executerOutilStudio, studioPertinent, type ConceptionLue, type DepotStudio, type EnvStudio, type PreparationLue, type StatsFile, type TravailLu } from '../agent/studio.ts';
import { intentionPhotoExtension, type DepotPhotoProjet, type PhotoDuTour } from '../agent/photo-projet.ts';
import { messagePlanPourLeParcours, type PlanLuParcours } from '../../_shared/extension/planLu.ts';
import { detecterIntentionMaisonNeuve } from '../../_shared/maisonNeuve/instructionsMaison.ts';
import { suiteDuParcoursMaison } from '../../_shared/maisonNeuve/parcoursMaison.ts';
import { type BatimentBdTopo } from '../../_shared/extension/bdtopoParcelle.ts';
import { facadesVoieDeLaParcelle } from '../agent/voisines-parcelle.ts';
import { verifierCouverture } from '../../../../src/lib/studio/couverturePhotoRue.ts';
import { imageSurPhotoReelle } from '../../../../src/lib/studio/photoReelle.ts';
import type { ResultatOutil } from '../agent/types.ts';

type Obj = Record<string, unknown>;
const lire = (chemin: string) => JSON.parse(Deno.readTextFileSync(new URL(chemin, import.meta.url)));

// ── Données figées (réelles) ──────────────────────────────────────────────────────────────────────────────────
export const FX = lire('../../../../src/spaces/copilot/studio3d/__fixtures__/extension-x3-reel.json');
export const PANORAMAX = lire('../../../../src/lib/studio/__fixtures__/panoramax-montreuil-AS0249.json');
export const PLAN_LU_STUDIO = lire('../../../../src/spaces/copilot/studio3d/__fixtures__/plan-lu-studio-g6.json');
type SiteFx = { idu: string; contourWgs84: [number, number][]; batiments: BatimentBdTopo[] };
export const P0646 = '930470000P0646';
export const SITE: SiteFx = FX.bdtopo.sites.find((s: SiteFx) => s.idu === P0646);
export const C = FX.conceptionP0646;
export const USER = '11111111-1111-4111-8111-111111111111';
export const ORIGINE = 'https://mimmoza.vercel.app';
export const ID_CONCEPTION = '44444444-4444-4444-8444-444444444444';

// ── Contrôles des textes vus par l'utilisateur ────────────────────────────────────────────────────────────────
/** Noms internes qui ne doivent jamais apparaître à l'écran. */
export const JARGON = /\b(?:serveur|la fiche|moteur|worker|extension_maison|maison_neuve|studio_[a-z_]+|preparation_id|conception_id|lot [A-Z]\d+[a-z]?|BatimentV2|contrat v2|D7a|D10)\b/i;
/** Annonce d'un lancement (3D, image, rendu) — permise seulement si un travail a réellement été créé au même tour. */
export const ANNONCE_LANCEMENT = /\b(?:je lance|j[’']ai lanc[ée]|est lanc[ée]e?\b|rendu (?:est )?en cours|je prépare (?:la|une) (?:maquette|3D)|voici (?:l[’']|votre )image)/i;

// ── Photo de la maison : JPEG minimal avec EXIF GPS (et direction de prise de vue) ────────────────────────────
export function jpegAvecGps(lat: number, lon: number, cap: number | null): Uint8Array {
  const dms = (v: number): [number, number][] => {
    const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - m) * 60 * 10000);
    return [[d, 1], [m, 1], [s, 10000]];
  };
  const entreesGps: { tag: number; type: number; n: number; val: number[] | string }[] = [
    { tag: 0x0001, type: 2, n: 2, val: lat >= 0 ? 'N' : 'S' },
    { tag: 0x0002, type: 5, n: 3, val: dms(lat).flat() },
    { tag: 0x0003, type: 2, n: 2, val: lon >= 0 ? 'E' : 'W' },
    { tag: 0x0004, type: 5, n: 3, val: dms(lon).flat() },
    ...(cap !== null ? [{ tag: 0x0010, type: 2, n: 2, val: 'T' }, { tag: 0x0011, type: 5, n: 1, val: [Math.round(cap * 100), 100] }] : []),
  ];
  const ifd0 = 8, ifdGps = ifd0 + 2 + 12 + 4;
  let donnees = ifdGps + 2 + entreesGps.length * 12 + 4;
  const buf = new Uint8Array(donnees + entreesGps.reduce((a, e) => a + (e.type === 5 ? e.n * 8 : 0), 0));
  const dv = new DataView(buf.buffer);
  buf.set([0x49, 0x49]); dv.setUint16(2, 42, true); dv.setUint32(4, ifd0, true);
  dv.setUint16(ifd0, 1, true);
  dv.setUint16(ifd0 + 2, 0x8825, true); dv.setUint16(ifd0 + 4, 4, true); dv.setUint32(ifd0 + 6, 1, true); dv.setUint32(ifd0 + 10, ifdGps, true);
  dv.setUint16(ifdGps, entreesGps.length, true);
  entreesGps.forEach((e, k) => {
    const o = ifdGps + 2 + k * 12;
    dv.setUint16(o, e.tag, true); dv.setUint16(o + 2, e.type, true); dv.setUint32(o + 4, e.n, true);
    if (e.type === 2) { const t = e.val as string; for (let i = 0; i < t.length; i++) buf[o + 8 + i] = t.charCodeAt(i); }
    else { dv.setUint32(o + 8, donnees, true); (e.val as number[]).forEach((x, i) => dv.setUint32(donnees + i * 4, x, true)); donnees += e.n * 8; }
  });
  const app1 = new Uint8Array(2 + 2 + 6 + buf.length);
  app1.set([0xff, 0xe1, ((app1.length - 2) >> 8) & 0xff, (app1.length - 2) & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  app1.set(buf, 10);
  return new Uint8Array([0xff, 0xd8, ...app1, 0xff, 0xd9]);
}

const M_LAT = 111_132;
const kx = (lat: number) => 111_320 * Math.cos(lat * Math.PI / 180);
export const centre = (() => {
  const a = SITE.contourWgs84.slice(0, -1);
  return { lon: a.reduce((s, p) => s + p[0], 0) / a.length, lat: a.reduce((s, p) => s + p[1], 0) / a.length };
})();
/** Point sur le trottoir, 8 m devant la limite sur rue de P0646. */
export const pointRue = (() => {
  const f = facadesVoieDeLaParcelle(C.parcelle).facades[0]!;
  const m = { lon: (f.debut[0] + f.fin[0]) / 2, lat: (f.debut[1] + f.fin[1]) / 2 };
  const dx = (m.lon - centre.lon) * kx(m.lat), dy = (m.lat - centre.lat) * M_LAT, d = Math.hypot(dx, dy);
  return { lon: m.lon + (dx / d) * 8 / kx(m.lat), lat: m.lat + (dy / d) * 8 / M_LAT };
})();
export const capVers = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) =>
  ((Math.atan2((b.lon - a.lon) * kx(a.lat), (b.lat - a.lat) * M_LAT) * 180 / Math.PI) + 360) % 360;
/** Photo prise depuis le trottoir, tournée vers la maison (comme l'essai d'Albé). */
export const photoDepuisLaRue = () => jpegAvecGps(pointRue.lat, pointRue.lon, capVers(pointRue, centre));

// ── Réseau simulé (réponses figées) ───────────────────────────────────────────────────────────────────────────
export interface OptionsReseau {
  /** La BD TOPO répond HTTP 400 quand ce prédicat est vrai (numéro d'appel WFS, à partir de 1). */
  panneBdTopo?: (appelWfs: number) => boolean;
  /** Le cadastre ne rend pas les parcelles voisines (HTTP 503) : la limite sur rue ne peut pas être déduite. */
  voisinesEnPanne?: boolean;
}
export function reseau(compteurs: { wfs: number; cadastreGeom: number; cadastre: number }, o: OptionsReseau = {}): typeof fetch {
  const bats = SITE.batiments.map((b) => ({
    type: 'Feature', id: b.id,
    properties: { cleabs: b.id, hauteur: b.hauteurM, nombre_d_etages: b.etages, altitude_minimale_sol: b.altitudeSolM, altitude_minimale_toit: b.altitudeToitMinM,
      altitude_maximale_toit: b.altitudeToitMaxM, usage_1: b.usage, nature: b.nature, construction_legere: b.legere, etat_de_l_objet: 'En service' },
    geometry: { type: 'Polygon', coordinates: b.anneaux.map((a) => [...a, a[0]]) },
  }));
  const parcelle = { type: 'Feature', properties: { idu: P0646, contenance: C.parcelle.surface_m2 ?? 500 }, geometry: C.parcelle.geometrie };
  const voisines = (C.parcelle.voisines.parcelles as { idu: string | null; geometrie: unknown }[]).map((v) => ({ type: 'Feature', properties: { idu: v.idu }, geometry: v.geometrie }));
  const json = (v: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(v), { status }));
  return ((url: string) => {
    const u = String(url);
    if (u.startsWith('https://data.geopf.fr/')) {
      compteurs.wfs += 1;
      if (o.panneBdTopo?.(compteurs.wfs)) return Promise.resolve(new Response('<ExceptionReport/>', { status: 400 }));
      return json({ type: 'FeatureCollection', features: bats });
    }
    if (u.startsWith('https://apicarto.ign.fr/api/cadastre/parcelle') && u.includes('geom=')) {
      compteurs.cadastreGeom += 1;
      if (o.voisinesEnPanne) return Promise.resolve(new Response('', { status: 503 }));
      return json({ type: 'FeatureCollection', features: [parcelle, ...voisines] });
    }
    if (u.startsWith('https://apicarto.ign.fr/api/cadastre/parcelle')) { compteurs.cadastre += 1; return json({ type: 'FeatureCollection', features: [parcelle] }); }
    if (u.startsWith('https://apicarto.ign.fr/api/gpu/')) return json({ features: [{ properties: { typezone: 'U', libelle: 'UC' } }] });
    if (u.startsWith('https://api.bdnb.io/')) return json([]);
    return Promise.resolve(new Response('{}', { status: 404 }));
  }) as typeof fetch;
}

// ── Base de données en mémoire ────────────────────────────────────────────────────────────────────────────────
export interface AppelOutil { tour: number; outil: string; input: Obj; resultat: ResultatOutil }
type Travail = TravailLu & { user_id: string; fiche: Obj; options: Obj };

export class Base {
  appels: AppelOutil[] = [];
  conceptions: Array<ConceptionLue & { user_id: string }> = [];
  preparations: Array<PreparationLue & { user_id: string }> = [];
  travaux: Travail[] = [];
  photosDeposees: string[] = [];
  stats: StatsFile | null = { attente: 0, plusAncienneAttente: null, enCours: 0, derniereActivite: null };

  sorties(outil: string): Obj[] {
    return this.appels.filter((a) => a.outil === outil && a.resultat.status === 'ok' && a.resultat.data).map((a) => a.resultat.data as Obj).reverse();
  }
  /** Ajoute la fiche de parcelle « réelle » de P0646 (avec ses voisines : limite sur rue connue). */
  ficheP0646(): void {
    this.conceptions.push({ id: ID_CONCEPTION, idu: P0646, commune: 'Montfermeil', user_id: USER, regles_plu: C.regles_plu ?? [], programme: null,
      parcelle: { idu: P0646, geometrie: C.parcelle.geometrie, surface_m2: C.parcelle.surface_m2 ?? null, source: 'cadastre', voisines: C.parcelle.voisines },
    } as unknown as ConceptionLue & { user_id: string });
  }

  depotExtension(): DepotExtension {
    return {
      conception: async (u, q) => (this.conceptions.filter((c) => c.user_id === u && (q.id ? c.id === q.id : q.idu ? c.idu === q.idu : false)).at(-1) ?? null) as never,
      conceptionDeLaConversation: async () => this.conceptions.at(-1)?.id ?? null,
      sortiesPrecedentes: async () => this.sorties(OUTIL_EXTENSION_MAISON),
      creerDossierParcelle: async (u, d) => {
        const id = crypto.randomUUID();
        this.conceptions.push({ id, idu: d.idu, commune: d.commune, parcelle: d.parcelle, regles_plu: [], programme: null, user_id: u } as never);
        return id;
      },
    };
  }
  depotMaison(): DepotMaison {
    return {
      conception: async (u, q) => (this.conceptions.filter((c) => c.user_id === u && (q.id ? c.id === q.id : q.idu ? c.idu === q.idu : false)).at(-1) ?? null) as never,
      sortiesPrecedentes: async () => this.sorties(OUTIL_MAISON_NEUVE),
      creerDossierParcelle: async (u, d) => {
        const id = crypto.randomUUID();
        this.conceptions.push({ id, idu: d.idu, commune: d.commune, parcelle: d.parcelle, regles_plu: [], programme: null, user_id: u } as never);
        return id;
      },
    };
  }
  depotPhoto(): DepotPhotoProjet {
    return { deposer: async (u, octets, type) => { const c = `${u}/${crypto.randomUUID()}.${type === 'image/png' ? 'png' : 'jpg'}`; this.photosDeposees.push(`${c}:${octets.length}`); return c; } };
  }
  depotStudio(): DepotStudio {
    const b = this;
    return {
      async conception(u, q) { return (b.conceptions.filter((c) => c.user_id === u && (!q.id || c.id === q.id) && (!q.idu || c.idu === q.idu)).at(-1) ?? null) as never; },
      async derniereVersion() { return null; },
      async enregistrerPreparation(u, l) { const id = crypto.randomUUID(); b.preparations.push({ ...structuredClone(l), id, user_id: u, cree_le: new Date().toISOString() } as never); return id; },
      async preparation(u, q) { return (b.preparations.filter((p) => p.user_id === u && (!q.id || p.id === q.id) && (!q.conceptionId || p.conception_id === q.conceptionId)).at(-1) ?? null) as never; },
      async typeRenduAutorise() { return true; },
      async statsFile() { return b.stats; },
      async travauxActifs(u) { return b.travaux.filter((t) => t.user_id === u && (t.statut === 'en_attente' || t.statut === 'en_cours')).length; },
      async travailParDevis(u, d) { return (b.travaux.find((t) => t.user_id === u && t.fiche.devis_id === d) ?? null) as never; },
      async questionBriefPosee() { return true; },
      async jetonsDevis() {
        return b.appels.filter((a) => a.outil === 'studio_lancer_rendu').reverse().map((a) => (a.resultat.data as { jeton_devis?: unknown } | undefined)?.jeton_devis).filter((j): j is string => typeof j === 'string');
      },
      async insererTravail(u, l) {
        const t = { id: crypto.randomUUID(), user_id: u, conversation_id: l.conversation_id, type: l.type, statut: 'en_attente', progression: 0, etape: null,
          resultat: null, elements_omis: [], erreur: null, cree_le: new Date().toISOString(), demarre_le: null, termine_le: null, fiche: l.fiche, options: l.options };
        b.travaux.push(t as never);
        return t as never;
      },
      async travail(u, q) { return (b.travaux.filter((t) => t.user_id === u && (!q.id || t.id === q.id)).at(-1) ?? null) as never; },
      async positionFile() { return 0; },
      async urlSigneeRendu(c) { return `https://exemple.supabase.co/storage/v1/object/sign/studio-rendus/${c}?token=t`; },
      async couverturePhotoRue(contour) {
        return await verifierCouverture(contour, (async () => new Response(JSON.stringify(PANORAMAX), { status: 200 })) as typeof fetch, () => Date.parse('2026-11-11T12:00:00Z'));
      },
      async sortiesExtension() { return b.sorties(OUTIL_EXTENSION_MAISON); },
      async optionsDernierRenduImage() { const t = b.travaux.filter((x) => x.type === 'image').at(-1); return t ? structuredClone(t.options) : null; },
      async sortiesMaison() { return b.sorties(OUTIL_MAISON_NEUVE); },
      async dernierParcours() {
        const a = b.appels.filter((x) => x.outil === OUTIL_EXTENSION_MAISON || x.outil === OUTIL_MAISON_NEUVE).at(-1);
        return (a?.outil as 'extension_maison' | 'maison_neuve' | undefined) ?? null;
      },
    } as DepotStudio;
  }
  /** La machine de rendu termine le dernier travail avec ce résultat (posé par le scénario). */
  terminerDernierTravail(resultat: Obj): Travail {
    const t = this.travaux.at(-1)!;
    Object.assign(t, { statut: 'termine', progression: 100, etape: 'Terminé', demarre_le: t.cree_le, termine_le: new Date().toISOString(), resultat });
    return t;
  }
}

// ── Journal des étapes (rapport lisible) ──────────────────────────────────────────────────────────────────────
export interface Etape { nom: string; ok: boolean; detail: string }
export class Journal {
  etapes: Etape[] = [];
  /** Observations qui ne sont pas des échecs (comportement qui dépend du vrai modèle de langage). */
  remarques: string[] = [];
  remarque(texte: string): void { this.remarques.push(texte); }
  verifier(nom: string, ok: boolean, detail = ''): boolean { this.etapes.push({ nom, ok: Boolean(ok), detail: ok ? '' : detail }); return Boolean(ok); }
  egal(nom: string, obtenu: unknown, attendu: unknown): boolean {
    const a = JSON.stringify(obtenu), e = JSON.stringify(attendu);
    return this.verifier(nom, a === e, `obtenu ${a?.slice(0, 300)} ; attendu ${e?.slice(0, 300)}`);
  }
  correspond(nom: string, texte: unknown, re: RegExp): boolean { return this.verifier(nom, re.test(String(texte ?? '')), `« ${String(texte ?? '').slice(0, 400)} » ne correspond pas à ${re}`); }
  absent(nom: string, texte: unknown, re: RegExp): boolean {
    const m = String(texte ?? '').match(re);
    return this.verifier(nom, !m, m ? `trouvé « ${m[0]} » dans « ${String(texte).slice(Math.max(0, (m.index ?? 0) - 80), (m.index ?? 0) + 120)} »` : '');
  }
}

// ── Le tour de chat (aiguillage + modèle simulé + affichage) ──────────────────────────────────────────────────
export interface DemandeStudio { outil: 'studio_preparer_3d' | 'studio_lancer_rendu' | 'studio_etat_rendu'; input?: Obj }
export interface OptionsTour {
  photo?: { octets: Uint8Array; nom?: string; mediaType?: string } | null;
  planLu?: PlanLuParcours | null;
  /** Identifiant de parcelle que le modèle transmet (il l'a lu dans le message ou le contexte). */
  idu?: string | null;
  /** Outils Studio que le modèle simulé appelle après l'outil imposé (s'ils lui sont proposés). */
  studio?: DemandeStudio[];
}
export interface Tour {
  n: number;
  texteUtilisateur: string;
  aiguillage: { extensionImposee: boolean; maisonImposee: boolean; studioPropose: boolean; parcoursEnCours: boolean; retouche: boolean;
    /** L'outil du parcours est seulement PROPOSÉ au modèle (pas imposé) : le modèle simulé l'appelle, comme la consigne le demande. */
    parcoursSeulementPropose: boolean };
  appels: AppelOutil[];
  /** Ce que l'utilisateur voit à l'écran (texte du serveur + texte du modèle + questions à choix). */
  affiche: string;
  /** Sortie de l'outil du parcours (extension ou maison) à ce tour. */
  parcours: Obj | null;
  studioRefuse: string[];
  travauxCrees: number;
}

export class Conversation {
  base = new Base();
  tours: Tour[] = [];
  compteurs = { wfs: 0, cadastreGeom: 0, cadastre: 0 };
  private minute = 0;
  constructor(readonly id: string, readonly reseauOptions: OptionsReseau = {}, readonly debut = Date.parse('2026-11-18T08:00:00Z')) {}

  private maintenant = () => this.debut + this.minute * 60_000;
  private dernierAffiche(): string { return this.tours.at(-1)?.affiche ?? ''; }

  async tour(texte: string, o: OptionsTour = {}): Promise<Tour> {
    this.minute += 1;
    const n = this.tours.length + 1;
    const precedent = this.dernierAffiche();
    const photoJointe = Boolean(o.photo);
    // Aiguillage recopié de index.ts (mêmes prédicats, même ordre).
    const parcoursEnCours = suiteDuParcours(precedent);
    const parcoursDansConversation = this.tours.some((t) => suiteDuParcours(t.affiche));
    const retouche = parcoursDansConversation && demandeRetouche(texte);
    const extensionImposee = detecterIntentionExtension(texte).extension || (parcoursEnCours && reponseAuParcours(texte)) || retouche
      || intentionPhotoExtension(texte, photoJointe) || messagePlanPourLeParcours(texte);
    const parcoursMaisonEnCours = !extensionImposee && suiteDuParcoursMaison(precedent);
    const maisonImposee = !extensionImposee && !parcoursEnCours && (detecterIntentionMaisonNeuve(texte) || (parcoursMaisonEnCours && texte.trim().length > 0));
    const studioPropose = studioPertinent([texte, precedent]) || retouche;

    const appels: AppelOutil[] = [];
    const avantTravaux = this.base.travaux.length;
    const photoDuTour: PhotoDuTour | null = o.photo ? { nom: o.photo.nom ?? 'maison.jpg', mediaType: o.photo.mediaType ?? 'image/jpeg', charger: async () => o.photo!.octets } : null;
    const enregistrer = (outil: string, input: Obj, resultat: ResultatOutil) => { const a = { tour: n, outil, input, resultat }; this.base.appels.push(a); appels.push(a); return a; };

    let parcours: Obj | null = null;
    const morceaux: string[] = [];
    let blocChoix: string | null = null;
    const inputParcours: Obj = o.idu ? { idu: o.idu } : {};
    const parcoursSeulementPropose = !extensionImposee && !maisonImposee && (parcoursEnCours || parcoursMaisonEnCours);
    const appelerExtension = extensionImposee || (parcoursSeulementPropose && parcoursEnCours);
    const appelerMaison = !appelerExtension && (maisonImposee || (parcoursSeulementPropose && parcoursMaisonEnCours));
    if (appelerExtension) {
      const r = await executerOutilExtension(inputParcours, {
        userId: USER, conversationId: this.id, texteUtilisateur: texte, depot: this.base.depotExtension(), fetch: reseau(this.compteurs, this.reseauOptions),
        maintenant: this.maintenant, photoDuTour, depotPhoto: this.base.depotPhoto(), planLu: o.planLu ?? null,
      });
      enregistrer(OUTIL_EXTENSION_MAISON, inputParcours, r);
      if (r.status === 'ok') parcours = r.data as Obj;
    } else if (appelerMaison) {
      const r = await executerOutilMaisonNeuve(inputParcours, {
        userId: USER, conversationId: this.id, texteUtilisateur: texte, depot: this.base.depotMaison(), fetch: reseau(this.compteurs, this.reseauOptions),
        maintenant: this.maintenant, photoDuTour, depotPhoto: this.base.depotPhoto(),
      });
      enregistrer(OUTIL_MAISON_NEUVE, inputParcours, r);
      if (r.status === 'ok') parcours = r.data as Obj;
    }
    if (parcours) {
      if (typeof parcours.texte_affiche === 'string' && parcours.texte_affiche) morceaux.push(parcours.texte_affiche);
      blocChoix = typeof parcours.bloc_choix === 'string' ? parcours.bloc_choix : null;
    }
    // Outils Studio demandés par le scénario : le modèle simulé ne les appelle que s'ils lui sont proposés.
    const studioRefuse: string[] = [];
    for (const d of o.studio ?? []) {
      if (!studioPropose) { studioRefuse.push(d.outil); continue; }
      const env: EnvStudio = { userId: USER, depot: this.base.depotStudio(), secret: 'secret-de-test', requete: `${this.id}-${n}-${d.outil}`, conversationId: this.id, origine: ORIGINE, maintenant: this.maintenant };
      const r = await executerOutilStudio(d.outil, d.input ?? {}, env);
      if (r) enregistrer(d.outil, d.input ?? {}, r);
    }
    // Texte du modèle simulé : il recopie la phrase de relance exacte (consigne du parcours) ; après un outil Studio, une
    // phrase neutre qui ne promet rien (le suivi du rendu s'affiche dans la carte du chat).
    const relance = parcours && typeof parcours.phrase_relance === 'string' ? parcours.phrase_relance : '';
    if (relance) morceaux.push(relance);
    if (blocChoix) morceaux.push(blocChoix);
    const t: Tour = {
      n, texteUtilisateur: texte, aiguillage: { extensionImposee, maisonImposee, studioPropose, parcoursEnCours, retouche, parcoursSeulementPropose },
      appels, affiche: morceaux.join('\n\n'), parcours, studioRefuse, travauxCrees: this.base.travaux.length - avantTravaux,
    };
    this.tours.push(t);
    return t;
  }

  /** Dernier appel de cet outil (tous tours confondus). */
  dernier(outil: string): AppelOutil | undefined { return this.base.appels.filter((a) => a.outil === outil).at(-1); }
}

/** Contrôles communs à chaque tour : aucun nom interne à l'écran, aucune annonce de lancement sans travail créé. */
export function controlerTour(j: Journal, t: Tour, prefixe: string): void {
  j.absent(`${prefixe} — tour ${t.n} : aucun nom interne à l’écran`, t.affiche, JARGON);
  if (t.travauxCrees === 0) j.absent(`${prefixe} — tour ${t.n} : aucune annonce de lancement sans rendu créé`, t.affiche, ANNONCE_LANCEMENT);
  for (const a of t.appels) if (a.resultat.status === 'error') j.verifier(`${prefixe} — tour ${t.n} : ${a.outil} sans erreur`, false, String(a.resultat.message ?? '').slice(0, 300));
}

/** Chaque ligne de donnée affichée porte un statut connu et une source. */
export function controlerStatuts(j: Journal, nom: string, lignes: unknown): void {
  const ls = Array.isArray(lignes) ? lignes as Obj[] : [];
  const STATUTS = new Set(['mesuree', 'confirmee', 'estimee', 'supposee', 'lue', 'deduite', 'calculee', 'saisie']);
  const fautives = ls.filter((l) => !STATUTS.has(String(l.statut)) || typeof l.source !== 'string' || !String(l.source).trim());
  j.verifier(nom, ls.length > 0 && fautives.length === 0, ls.length === 0 ? 'aucune ligne' : `lignes sans statut/source : ${JSON.stringify(fautives).slice(0, 300)}`);
}

/** Une image n'est donnée (lien) que si elle est faite sur une vraie photo. */
export function controlerImage(j: Journal, nom: string, sortieEtat: ResultatOutil | undefined, resultatMachine: Obj): void {
  const liens = ((sortieEtat?.data as Obj | undefined)?.liens as { images?: unknown[] } | undefined)?.images ?? [];
  if (imageSurPhotoReelle(resultatMachine)) j.verifier(nom, liens.length > 0, 'image sur vraie photo mais aucun lien');
  else j.verifier(nom, liens.length === 0, `image SANS vraie photo calée et pourtant ${liens.length} lien(s) donné(s)`);
}
