// supabase/functions/copilot-chat/agent/maison-neuve-g10b.test.ts
// LOT G10b (18/11/2026) — maison neuve sur photo de terrain, de bout en bout côté site :
//   parcours `maison_neuve` (outil du chat) → gabarit placé, reculs mesurés, permis et architecte indicatifs →
//   projet de maison (contrat) → devis puis lancement de l'IMAGE (fiche de LA maison, jamais un immeuble, jamais une
//   image d'étude) → textes sans nom interne.
// Données RÉELLES : contour, voisines et règles de la parcelle 930470000P0646 (fixture X3) ; réseau simulé.
// Lancer : deno test --no-lock --no-check -A --node-modules-dir=none supabase/functions/copilot-chat/agent/maison-neuve-g10b.test.ts
import * as na from 'node:assert/strict';
import { executerOutilMaisonNeuve, lireEtatMaison, parcelleMaison, precedentMaison, projetMaisonDesSorties, Q_COTE_RUE, relanceMaison, type DepotMaison } from './maison-neuve.ts';
import { avertissementsMaison, commandeMaison, ficheMaison, titreMaison } from './studio-maison.ts';
import { executerOutilStudio, type ConceptionLue, type DepotStudio, type EnvStudio, type PreparationLue, type StatsFile, type TravailLu } from './studio.ts';
import { batimentV2Maison, clausesMaison, lireProjetMaison, menuiseriesStudio, type ProjetMaison } from '../../_shared/maisonNeuve/contratMaison.ts';
import { distancePolygoneSegment } from '../../_shared/maisonNeuve/gabaritMaison.ts';
import { lireCouverture, rotationDuRectangle } from '../../_shared/maisonNeuve/projetMaison.ts';
import { candidatsCoteRue } from '../../_shared/extension/coteRue.ts';
import { contourEnLambert93, origineParcelle, type BatimentBdTopo } from '../../_shared/extension/bdtopoParcelle.ts';
import { facadesVoieDeLaParcelle } from './voisines-parcelle.ts';
import { validerProjet } from '../../../../src/spaces/promoteur/shared/echangeStudio/mimmozaProjetV2.ts';
import { estTravailExtension, photoRequiseDuResultat, TEXTES_PHOTO_REQUISE_TERRAIN } from '../../../../src/lib/studio/photoReelle.ts';

const FX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/extension-x3-reel.json', import.meta.url)));
type SiteFx = { idu: string; contourWgs84: [number, number][]; batiments: BatimentBdTopo[] };
const P0646 = '930470000P0646';
const SITE: SiteFx = FX.bdtopo.sites.find((s: SiteFx) => s.idu === P0646);
const C = FX.conceptionP0646;
const USER = '11111111-1111-4111-8111-111111111111';
const CONV = 'conv-g10b';
const JARGON = /\b(?:serveur|la fiche|moteur|maison_neuve|extension_maison|studio_\w+|lot [A-Z]\d|BatimentV2|contrat v2)\b/i;
const MAINTENANT = () => Date.parse('2026-11-18T09:00:00Z');

/** Réseau simulé : cadastre (parcelle + voisines), BD TOPO (bâtiments réels de la parcelle), le reste en panne. */
function reseau(o: { voisines?: boolean; bdtopo?: boolean } = {}): typeof fetch {
  const parcelle = { type: 'Feature', properties: { idu: P0646, contenance: C.parcelle.surface_m2 ?? 750 }, geometry: C.parcelle.geometrie };
  const voisines = (C.parcelle.voisines.parcelles as { idu: string | null; geometrie: unknown }[]).map((v) => ({ type: 'Feature', properties: { idu: v.idu }, geometry: v.geometrie }));
  const bats = SITE.batiments.map((b) => ({
    type: 'Feature', id: b.id,
    properties: { cleabs: b.id, hauteur: b.hauteurM, nombre_d_etages: b.etages, altitude_minimale_sol: b.altitudeSolM, altitude_minimale_toit: b.altitudeToitMinM,
      altitude_maximale_toit: b.altitudeToitMaxM, usage_1: b.usage, nature: b.nature, construction_legere: b.legere, etat_de_l_objet: 'En service' },
    geometry: { type: 'Polygon', coordinates: b.anneaux.map((a) => [...a, a[0]]) },
  }));
  return ((url: string) => {
    const u = String(url);
    if (u.startsWith('https://data.geopf.fr/')) return Promise.resolve(o.bdtopo === false ? new Response('', { status: 503 }) : new Response(JSON.stringify({ type: 'FeatureCollection', features: bats }), { status: 200 }));
    if (u.startsWith('https://apicarto.ign.fr/api/cadastre/parcelle') && u.includes('geom=')) {
      return Promise.resolve(o.voisines === false ? new Response('', { status: 503 }) : new Response(JSON.stringify({ type: 'FeatureCollection', features: [parcelle, ...voisines] }), { status: 200 }));
    }
    if (u.startsWith('https://apicarto.ign.fr/api/cadastre/parcelle')) return Promise.resolve(new Response(JSON.stringify({ type: 'FeatureCollection', features: [parcelle] }), { status: 200 }));
    return Promise.resolve(new Response('{}', { status: 404 }));
  }) as typeof fetch;
}

const conception = { id: '44444444-4444-4444-8444-444444444444', idu: P0646, commune: 'Montfermeil', parcelle: C.parcelle, regles_plu: C.regles_plu };

/** Joue des messages successifs (comme le chat : sorties relues du plus récent au plus ancien). */
async function jouer(messages: string[], o: { conception?: boolean; voisines?: boolean; idu?: string | null } = {}) {
  const sorties: Record<string, unknown>[] = [];
  const dossiers: unknown[] = [];
  const depot: DepotMaison = {
    conception: async (_u, q) => (o.conception !== false && (q.idu === P0646 || q.id === conception.id) ? conception : null),
    sortiesPrecedentes: async () => [...sorties].reverse(),
    creerDossierParcelle: async (_u, d) => { dossiers.push(d); return '55555555-5555-4555-8555-555555555555'; },
  };
  const res = [];
  for (const [i, m] of messages.entries()) {
    const r = await executerOutilMaisonNeuve(i === 0 && o.idu !== null ? { idu: o.idu ?? P0646 } : {}, {
      userId: USER, conversationId: CONV, texteUtilisateur: m, depot, fetch: reseau({ voisines: o.voisines }), maintenant: MAINTENANT,
    });
    if (r.status === 'ok') sorties.push(r.data!);
    res.push(r);
  }
  return { res, sorties, dossiers };
}

const DEMANDE = 'Je veux construire une maison de 120 m² habitables, R+1, toit 2 pans en ardoise, menuiseries blanches';

Deno.test('G10b-1 : « maison de 120 m² R+1 toit 2 pans » → maison placée, reculs respectés, permis + architecte indicatifs, projet transmissible', async () => {
  const { res } = await jouer([DEMANDE]);
  const r = res[0]!;
  na.equal(r.status, 'ok', r.message);
  const d = r.data!;
  na.equal(d.etape, 'termine', String(d.texte_affiche));
  const p = d.projet_maison as ProjetMaison;
  const lu = lireProjetMaison(p);
  na.ok(lu.ok, JSON.stringify(lu));
  // Demande reprise telle quelle, avec ses statuts.
  na.equal(p.maison.niveaux.valeur, 2);
  na.equal(p.maison.toit.valeur, 'deux-pans');
  na.equal(p.maison.surfaceHabitableM2.valeur, 120);
  na.equal(p.habillage.couverture?.valeur, 'ardoise');
  na.equal(p.habillage.couverture?.statut, 'confirmee');
  na.equal(p.habillage.menuiseries.valeur, 'blanc');
  na.equal(p.habillage.facade.statut, 'supposee', 'enduit : convention dite');
  // Reculs : chaque distance REMESURÉE ici (contour du projet) ≥ recul requis, et égale à la mesure du parcours (cm).
  const contour = p.parcelle.contourScene;
  na.ok(p.maison.reculs.length === contour.length);
  for (const rc of p.maison.reculs) {
    const dist = distancePolygoneSegment(p.maison.coinsScene, contour[rc.limite]!, contour[(rc.limite + 1) % contour.length]!);
    // Le parcours publie ses mesures, ses coins et le contour au millimètre (écart ≤ 1,5 mm).
    na.ok(Math.abs(dist - rc.mesureM) <= 0.0015, `limite ${rc.limite} : ${dist} ≠ ${rc.mesureM}`);
    na.ok(rc.mesureM + 0.005 >= rc.requisM, `limite ${rc.limite} : ${rc.mesureM} < ${rc.requisM}`);
  }
  na.ok(p.maison.reculs.some((x) => x.categorie === 'voie'), 'la rue est connue (voisines du dossier)');
  // Dimensions = gabarit (rectangle) ; rotation recalculée = rotation transmise.
  const rr = rotationDuRectangle(p.maison.coinsScene);
  na.equal(rr.longueurM, p.maison.longueurM);
  na.ok(Math.abs(rr.longueurM * rr.largeurM - p.maison.empriseM2) < 0.1);
  // Autorisation : permis de construire ; architecte dit (obligatoire / non / à confirmer) ; délai.
  na.equal(p.autorisation.regime, 'PC');
  na.ok(['obligatoire', 'non-obligatoire', 'a-confirmer'].includes(p.autorisation.architecte));
  na.match(String(d.texte_affiche), /permis de construire/);
  na.match(String(d.texte_affiche), /architecte/i);
  na.match(String(d.texte_affiche), /Habillage de l’image et des plans/);
  na.match(String(d.texte_affiche), /Règles d’implantation utilisées/);
  // Bâtiment existant sur la parcelle (BD TOPO réelle) : dit, sans bloquer.
  na.match(String(d.texte_affiche), /porte déjà .*BD TOPO.*démolition/);
  // Relance et consigne : rien d'annoncé qui n'a pas eu lieu.
  na.match(String(d.phrase_relance), /Votre maison est placée sur le terrain/);
  na.match(r.message!, /SANS appeler studio_preparer_3d/);
  na.doesNotMatch(String(d.texte_affiche), JARGON);
  na.doesNotMatch(String(d.phrase_relance), JARGON);
});

Deno.test('G10b-2 : questions qui manquent, puis maison placée ; état relu et revalidé', async () => {
  const { res, sorties } = await jouer(['Je voudrais faire construire une maison neuve sur mon terrain', 'Surface habitable : 120 m² · Niveaux : Un étage (R+1) · Toit : 2 pans · Style : Traditionnel · Menuiseries : Anthracite']);
  na.equal(res[0]!.data!.etape, 'programme');
  na.match(String(res[0]!.data!.bloc_choix), /"id":"mn_surface"/);
  na.equal(res[1]!.data!.etape, 'termine', String(res[1]!.data!.texte_affiche));
  const prec = precedentMaison([...sorties].reverse());
  na.equal(prec.idu, P0646);
  na.equal(prec.etat.demande.surfaceHabitableM2?.valeur, 120);
  na.equal(lireEtatMaison({ v: 1, demande: { surfaceHabitableM2: { valeur: 9999, statut: 'confirmee', source: 'x' } } }).demande.surfaceHabitableM2, undefined, 'valeur hors bornes écartée');
  const p = projetMaisonDesSorties([...sorties].reverse())!;
  na.equal(p.habillage.couverture?.valeur, 'tuiles', 'couverture non dite : tuiles SUPPOSÉES');
  na.equal(p.habillage.couverture?.statut, 'supposee');
  na.equal(p.habillage.style?.valeur, 'traditionnel');
});

Deno.test('G10b-3 : sans dossier ni voisines, le côté de la rue est demandé en puces ; le côté choisi place la maison ; dossier minimal créé', async () => {
  const fac = facadesVoieDeLaParcelle(C.parcelle).facades;
  const milieu = (a: readonly number[], b: readonly number[]) => [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2];
  const pres = (p: number[], q: number[]) => Math.hypot((p[0]! - q[0]!) * 111_320 * Math.cos(q[1]! * Math.PI / 180), (p[1]! - q[1]!) * 110_540) < 1;
  const cote = candidatsCoteRue(SITE.contourWgs84).find((x) => x.segments.some((s) => fac.some((r) => pres(milieu(s.debut, s.fin), milieu(r.debut, r.fin)))))!;
  na.ok(cote);
  const { res, dossiers } = await jouer([DEMANDE, `${Q_COTE_RUE.libelle} : ${cote.libelle}`], { conception: false, voisines: false });
  na.equal(res[0]!.data!.etape, 'cote_rue', String(res[0]!.data!.texte_affiche));
  na.match(String(res[0]!.data!.bloc_choix), /"id":"mn_cote_rue"/);
  na.match(String(res[0]!.data!.phrase_relance), /de quel côté du terrain se trouve la rue/);
  na.equal(res[0]!.data!.projet_maison, undefined);
  na.match(res[0]!.message!, /N’EST PAS \(encore\) placée/);
  const fin = res[1]!.data!;
  na.equal(fin.etape, 'termine', String(fin.texte_affiche));
  na.match(String(fin.texte_affiche), /Côté de la rue : côté de la rue désigné par vous/);
  na.ok(lireProjetMaison(fin.projet_maison).ok);
  na.equal(dossiers.length, 1, 'dossier minimal de la parcelle créé une fois');
  na.equal(fin.dossier_parcelle_id, '55555555-5555-4555-8555-555555555555');
});

Deno.test('G10b-4 : classement des limites (voie, fond opposé, séparatives) et parcelle sans rue', () => {
  const l93 = contourEnLambert93(SITE.contourWgs84);
  const o = origineParcelle(l93);
  const fac = facadesVoieDeLaParcelle(C.parcelle).facades;
  const p = parcelleMaison(l93, o, fac, null);
  na.ok(p.categories.includes('voie'));
  na.equal(p.categories.filter((c) => c === 'fond').length, 1);
  na.ok(p.categories.every((c) => c !== null));
  const sans = parcelleMaison(l93, o, [], null);
  na.ok(sans.categories.every((c) => c === null), 'sans rue : rien n’est classé (rien n’est deviné)');
  na.equal(lireCouverture('toit en ardoises'), 'ardoise');
  na.equal(lireCouverture('maison contemporaine'), null);
});

Deno.test('G10b-5 : fiche de rendu = LA maison du parcours (bâtiment du contrat v2, clauses, menuiseries), jamais un immeuble', async () => {
  const { res } = await jouer([DEMANDE]);
  const p = res[0]!.data!.projet_maison as ProjetMaison;
  const f = ficheMaison(p, CONV, '2026-11-18T09:00:00.000Z', 'session-1', 'https://mimmoza.vercel.app');
  na.ok(f.ok, JSON.stringify(f));
  if (!('valeur' in f)) return;
  const fiche = f.valeur as Record<string, unknown>;
  const charge = fiche.charge as Record<string, unknown>;
  na.ok(validerProjet(charge).ok, 'projet v2 valide');
  const bats = charge.batiments as Record<string, unknown>[];
  na.equal(bats.length, 1);
  na.deepEqual(bats[0], JSON.parse(JSON.stringify(batimentV2Maison(p))));
  na.equal(bats[0]!.nom, 'Maison');
  na.equal(bats[0]!.niveaux, 2);
  na.equal(bats[0]!.largeurM, Math.round(p.maison.longueurM * 100) / 100);
  na.deepEqual((fiche.habillage_batiments as { clauses: string[] }).clauses, clausesMaison(p));
  na.deepEqual(clausesMaison(p), ['façade en enduit clair', 'toiture à deux pans en ardoise']);
  for (const c of clausesMaison(p)) na.match(c, /^[\p{L} '’-]+$/u, 'clause lisible par la machine de rendu (liste fermée)');
  na.equal((fiche.habillage_batiments as { details?: { menuiseries?: string } }).details?.menuiseries, menuiseriesStudio(p));
  na.equal(menuiseriesStudio(p), 'av-aluminium-blanc');
  na.ok(lireProjetMaison(fiche.projet_maison).ok);
  na.ok(((charge.site as Record<string, unknown>).facadesVoie as unknown[]).length >= 1, 'limite sur rue transmise');
  na.match(commandeMaison(p), /^Crée une maison R\+1 de \d+(,\d+)? mètres sur \d+(,\d+)?, façade en enduit clair, toiture à deux pans en ardoise\.$/);
  na.equal('brief_rendu' in fiche, false);
  na.doesNotMatch(JSON.stringify(fiche), /immeuble|Plot|logements?" *: *[1-9]|barre de logements/i);
  na.match(String((charge.programme as Record<string, unknown>).commandeArchitecture ?? ''), /^Crée une maison /);
  na.doesNotMatch(titreMaison(p), JARGON);
  for (const a of avertissementsMaison(p, null)) na.doesNotMatch(a, JARGON);
  // Fixture partagée avec l'essai de bout en bout du Studio (même fiche que la machine de rendu recevra).
  const sortie = Deno.env.get('G10B_FIXTURE');
  if (sortie) Deno.writeTextFileSync(sortie, JSON.stringify(fiche, null, 2));
});

// ── Studio : devis puis lancement (réseau et base simulés) ─────────────────────────────────────────────────────
class Depot implements DepotStudio {
  travaux: Array<TravailLu & { user_id: string; fiche: Record<string, unknown>; options: Record<string, unknown> }> = [];
  appels: Array<Record<string, unknown>> = [];
  maison: Record<string, unknown>[] = [];
  dernier: 'extension_maison' | 'maison_neuve' | null = 'maison_neuve';
  preparations: PreparationLue[] = [];
  stats: StatsFile | null = { attente: 0, plusAncienneAttente: null, enCours: 0, derniereActivite: null };
  async conception(): Promise<ConceptionLue | null> { return null; }
  async derniereVersion() { return null; }
  async enregistrerPreparation() { throw new Error('aucune 3D préparée pour une maison neuve'); }
  async preparation() { return null; }
  async typeRenduAutorise() { return true; }
  async statsFile() { return this.stats; }
  async travauxActifs() { return 0; }
  async travailParDevis(u: string, d: string) { return this.travaux.find((t) => t.user_id === u && t.fiche.devis_id === d) ?? null; }
  async questionBriefPosee() { return false; }
  async jetonsDevis() { return this.appels.slice().reverse().map((a) => (a.data as { jeton_devis?: unknown } | undefined)?.jeton_devis).filter((j): j is string => typeof j === 'string'); }
  async insererTravail(u: string, l: { conversation_id: string; type: string; fiche: Record<string, unknown>; options: Record<string, unknown> }) {
    const t = { id: crypto.randomUUID(), user_id: u, conversation_id: l.conversation_id, type: l.type, statut: 'en_attente', progression: 0, etape: null,
      resultat: null, elements_omis: [], erreur: null, cree_le: new Date().toISOString(), demarre_le: null, termine_le: null, fiche: l.fiche, options: l.options };
    this.travaux.push(t as never);
    return t as never;
  }
  async travail(u: string) { return (this.travaux.filter((t) => t.user_id === u).at(-1) ?? null) as never; }
  async positionFile() { return 0; }
  async urlSigneeRendu(c: string) { return `https://exemple.supabase.co/storage/v1/object/sign/studio-rendus/${c}?token=t`; }
  async sortiesExtension() { return []; }
  async sortiesMaison() { return [...this.maison]; }
  async dernierParcours() { return this.dernier; }
}
const env = (d: DepotStudio, requete: string): EnvStudio => ({ userId: USER, depot: d, secret: 'secret-de-test', requete, conversationId: CONV, origine: 'https://mimmoza.vercel.app', maintenant: MAINTENANT });

Deno.test('G10b-6 : image de la maison — devis (fond photo réelle, jamais « étude »), accord, fiche de LA maison ; projet modifié → refus ; pas de 3D préparée', async () => {
  const { sorties } = await jouer([DEMANDE]);
  const d = new Depot();
  d.maison = [...sorties].reverse();
  // Aucune 3D préparée (ni immeuble ni logements) pour une maison neuve.
  const prep = await executerOutilStudio('studio_preparer_3d', {}, env(d, 'P0'));
  na.equal(prep?.status, 'partial');
  na.match(prep!.message!, /MAISON NEUVE/);
  // Film refusé (image seulement).
  const film = await executerOutilStudio('studio_lancer_rendu', { type: 'film' }, env(d, 'F0'));
  na.equal(film?.status, 'partial');
  // Devis : fond « photo de la rue » (aucune photo du terrain dans la conversation), même si le modèle demande « étude ».
  const r1 = await executerOutilStudio('studio_lancer_rendu', { type: 'image', options: { fond: 'etude' } }, env(d, 'R1'));
  na.equal(r1?.status, 'confirmation_requise', r1?.message);
  const devis = r1!.data!.devis as Record<string, unknown>;
  na.match(String(devis.fond), /rue/i);
  na.equal((r1!.data!.options as Record<string, unknown>).fond, 'photo_rue');
  na.equal('habillage' in devis, false);
  na.ok((devis.avertissements as string[]).some((a) => /VRAIE photo/.test(a)));
  na.doesNotMatch(JSON.stringify(devis), /logement|immeuble/i);
  // Accord au message suivant → travail créé avec LA maison.
  d.appels.push(structuredClone(r1!) as unknown as Record<string, unknown>);
  const r2 = await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env(d, 'R2'));
  na.equal(r2?.status, 'ok', r2?.message);
  const t = d.travaux.at(-1)!;
  na.ok(lireProjetMaison(t.fiche.projet_maison).ok);
  na.equal(((t.fiche.charge as Record<string, unknown>).batiments as unknown[]).length, 1);
  na.equal('projet_extension' in t.fiche, false);
  na.equal(t.options.fond, 'photo_rue');
  // Déjà lancé : rien n'est relancé.
  const r3 = await executerOutilStudio('studio_lancer_rendu', { confirmer: true, jeton_devis: r1!.data!.jeton_devis }, env(d, 'R3'));
  na.equal((r3!.data as Record<string, unknown>).deja_lance, true);
  na.equal(d.travaux.length, 1);
  // Nouveau devis puis projet modifié avant l'accord : refus (le devis ne décrit plus la maison).
  const r4 = await executerOutilStudio('studio_lancer_rendu', { type: 'image', options: { ambiance: 'fin_de_journee' } }, env(d, 'R4'));
  na.equal(r4?.status, 'confirmation_requise', r4?.message);
  d.appels.push(structuredClone(r4!) as unknown as Record<string, unknown>);
  const autre = await jouer(['Je veux construire une maison de 100 m² habitables de plain-pied, toit plat']);
  d.maison = [...autre.sorties].reverse();
  const r5 = await executerOutilStudio('studio_lancer_rendu', { confirmer: true, jeton_devis: r4!.data!.jeton_devis }, env(d, 'R5'));
  na.notEqual(r5?.status, 'ok');
  na.match(r5!.message!, /a changé depuis ce devis/);
  // Un parcours d'extension plus récent l'emporte : la maison neuve n'est plus prise.
  d.dernier = 'extension_maison';
  const r6 = await executerOutilStudio('studio_preparer_3d', {}, env(d, 'P1'));
  na.doesNotMatch(r6?.message ?? '', /MAISON NEUVE/);
});

Deno.test('G10b-7 : résultat de maison sans photo calée → aucune image, photo du TERRAIN demandée (textes du terrain)', () => {
  const resultat = { image_path: null, images: [], maison: { livrable: false }, photo_requise: { code: 'aucune_photo', texte: 'x', raison: null, atelier: false, source: null } };
  na.equal(estTravailExtension({ resultat }), true, 'même garde que l’extension');
  const pr = photoRequiseDuResultat(resultat)!;
  na.equal(pr.nature, 'maison');
  na.equal(pr.texte, TEXTES_PHOTO_REQUISE_TERRAIN.aucune_photo);
  const livre = { maison: { livrable: true }, photomontage: { statut: 'livre', source_photo: { type: 'client' } }, images: [{ jpeg_path: 'u/j/a.jpg' }] };
  na.equal(photoRequiseDuResultat(livre), null);
  for (const t of Object.values(TEXTES_PHOTO_REQUISE_TERRAIN)) na.doesNotMatch(t, JARGON);
  na.match(relanceMaison({ etape: 'termine', gabarit: null }, { photo: true }), /sur votre photo du terrain, avec ses plans/);
});
