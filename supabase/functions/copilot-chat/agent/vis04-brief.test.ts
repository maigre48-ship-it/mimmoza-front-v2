// deno test --no-lock --no-check -A supabase/functions/copilot-chat/agent/vis04-brief.test.ts
// VIS-04 (18/11/2026) — brief projet relié au rendu, côté serveur (copilot-chat) :
//   · bloc ```mimmoza-brief``` : champs `projet` (brief projet de l'étude) et `vues` (catalogue commun) relus, validés ;
//   · devis : vues cochées (seules les vues livrées partent, les autres sont DITES), brief projet résumé, empreinte
//     signée dans le jeton ; confirmation : le brief projet est relu dans le fil par son empreinte (sinon rien n'est lancé) ;
//   · fiche : le brief part dans le contrat v2 par construireProjetChat (même passage que FilmVisitePanel) ;
//   · rétrocompatibilité : sans brief projet, fiche et options strictement identiques.
// Données RÉELLES : cadastre 93048000AS0249 (Montreuil), préparation AE0414 (fixtures des lots P2 / C7). Réseau simulé.
import * as na from 'node:assert/strict';
import {
  briefDuMessage, executerOutilStudio, ficheDepuisPreparation, validerOptionsRendu,
  type ConceptionLue, type DepotStudio, type EnvStudio, type PreparationLue, type StatsFile, type TravailLu,
} from './studio.ts';
import { verifierCouverture } from '../../../../src/lib/studio/couverturePhotoRue.ts';
import { champsContrat, empreinteChamps, assemblerBriefProjet, type ChampsContratBrief } from '../../../../src/lib/studio/briefProjet.ts';
import { validerProjet } from '../../../../src/spaces/promoteur/shared/echangeStudio/mimmozaProjetV2.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const CONV = 'conv-vis04';
const IDU = '93048000AS0249';
const CADASTRE = JSON.parse(await Deno.readTextFile(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/cadastre-93048000AS0249.json', import.meta.url)));
const PANORAMAX = JSON.parse(await Deno.readTextFile(new URL('../../../../src/lib/studio/__fixtures__/panoramax-montreuil-AS0249.json', import.meta.url)));
const PREPARATION_AE0414 = JSON.parse(await Deno.readTextFile(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/preparation-AE0414.json', import.meta.url))).ligne as PreparationLue;
const parcelleAS0249 = () => ({
  idu: IDU, geometrie: CADASTRE.parcelle.geometry, surface_m2: null, source: 'cadastre (relevé réel)',
  voisines: { statut: 'disponibles', source: 'API Carto IGN', parcelles: CADASTRE.voisines.map((v: { geometry: unknown; properties?: { idu?: string } }) => ({ idu: v.properties?.idu ?? null, geometrie: v.geometry })) },
});

// ── Dépôt en mémoire (repris de photo-rue.test.ts, + messages du fil) ───────────────────────────────
class Depot implements DepotStudio {
  conceptions: Array<ConceptionLue & { user_id: string }> = [];
  preparations: Array<PreparationLue & { user_id: string }> = [];
  travaux: Array<TravailLu & { user_id: string; fiche: Record<string, unknown>; options: Record<string, unknown> }> = [];
  appels: Array<Record<string, unknown>> = [];
  imageAutorisee: boolean | null = true;
  stats: StatsFile | null = { attente: 0, plusAncienneAttente: null, enCours: 0, derniereActivite: null };
  couvertures = 0;
  /** VIS-04 : messages utilisateur portant un bloc ```mimmoza-brief``` (plus récent d'abord). */
  messages: { texte: string; cree_le: string }[] = [];
  async briefsMessages() { return this.messages; }
  async conception(u: string, q: { id?: string | null; idu?: string | null }) {
    return this.conceptions.filter((c) => c.user_id === u && (!q.id || c.id === q.id) && (!q.idu || c.idu === q.idu)).at(-1) ?? null;
  }
  async derniereVersion() { return null; }
  async enregistrerPreparation(u: string, l: Omit<PreparationLue, 'id' | 'cree_le'>) {
    const deja = this.preparations.find((p) => p.user_id === u && p.empreinte === l.empreinte);
    if (deja) return deja.id;
    const id = crypto.randomUUID();
    this.preparations.push({ ...structuredClone(l), id, user_id: u, cree_le: new Date().toISOString() });
    return id;
  }
  async preparation(u: string, q: { id?: string | null; conceptionId?: string | null; conversationId?: string | null }) {
    return this.preparations.filter((p) => p.user_id === u && (!q.id || p.id === q.id) && (!q.conceptionId || p.conception_id === q.conceptionId)).at(-1) ?? null;
  }
  async typeRenduAutorise() { return this.imageAutorisee; }
  async statsFile() { return this.stats; }
  async travauxActifs(u: string) { return this.travaux.filter((t) => t.user_id === u && ['en_attente', 'en_cours'].includes(t.statut)).length; }
  async travailParDevis(u: string, d: string) { return this.travaux.find((t) => t.user_id === u && t.fiche.devis_id === d) ?? null; }
  async questionBriefPosee() { return true; }
  async jetonsDevis() {
    return this.appels.slice().reverse().map((a) => (a.data as { jeton_devis?: unknown } | undefined)?.jeton_devis).filter((j): j is string => typeof j === 'string');
  }
  async insererTravail(u: string, l: { conversation_id: string; type: string; fiche: Record<string, unknown>; options: Record<string, unknown> }) {
    const t = { id: crypto.randomUUID(), user_id: u, conversation_id: l.conversation_id, type: l.type, statut: 'en_attente', progression: 0, etape: null,
      resultat: null, elements_omis: [], erreur: null, cree_le: new Date().toISOString(), demarre_le: null, termine_le: null, fiche: l.fiche, options: l.options };
    this.travaux.push(t);
    return t;
  }
  async travail(u: string, q: { id?: string | null }) { return this.travaux.filter((t) => t.user_id === u && (!q.id || t.id === q.id)).at(-1) ?? null; }
  async positionFile() { return 0; }
  async urlSigneeRendu(c: string) { return `https://exemple.supabase.co/storage/v1/object/sign/studio-rendus/${c}?token=t`; }
  /** Couverture : vrai code (verifierCouverture), réseau simulé avec la réponse RÉELLE de l'instance IGN. */
  async couverturePhotoRue(contour: [number, number][]) {
    this.couvertures++;
    return await verifierCouverture(contour, (async () => new Response(JSON.stringify(PANORAMAX), { status: 200 })) as typeof fetch, () => Date.parse('2026-11-11T12:00:00Z'));
  }
}

const env = (d: DepotStudio, requete: string, extra: Partial<EnvStudio> = {}): EnvStudio =>
  ({ userId: USER, depot: d, secret: 'secret-de-test', requete, conversationId: CONV, origine: 'https://mimmoza.vercel.app', ...extra });

async function depotPrepare(): Promise<Depot> {
  const d = new Depot();
  d.conceptions.push({
    id: '44444444-4444-4444-8444-444444444444', idu: IDU, commune: 'Montreuil', user_id: USER, parcelle: parcelleAS0249(), regles_plu: [],
    programme: { nb_logements: 6, gabarit: 'R+3' },
  });
  const r = await executerOutilStudio('studio_preparer_3d', {}, env(d, 'P0'));
  na.equal(r?.status, 'ok', r?.message);
  return d;
}

/** Brief projet d'une étude : direction retenue, programme T2/T3, habillage brique claire, vues du pack. */
function briefProjet(): ChampsContratBrief {
  const b = assemblerBriefProjet({
    etudeId: 'etude-vis04', precedent: null, maintenant: '2026-11-18T12:00:00.000Z',
    style: { target: 'Jeunes actifs', selectedFamily: 'durable', generatedAt: '2026-11-18T10:00:00.000Z', directions: [
      { family: 'durable', title: 'Durable chaleureux', intent: 'Matières naturelles', palette: [{ name: 'Bronze', hex: '#7D6748', use: 'menuiseries' }], materials: ['Bois certifié'], sourceIds: [] },
    ] },
    programme: { batiments: [{ niveaux: 4, typologies: { T2: 10, T3: 6 }, surfaces: { T2: 48, T3: 66 } }] },
    habillage: { facade: 'brique', teinte: 'claire', menuiseries: 'anthracite', garde_corps: 'verre', balcons: 'balcons' },
    reglages: { gamme: 'premium', vues: ['trois_quarts_gauche', 'aerienne', 'terrasse'], saison: 'automne', precisions: 'lumière dorée' },
  });
  return champsContrat(b);
}
const bloc = (o: Record<string, unknown>) => `Vues de l’image : test.\n\n\`\`\`mimmoza-brief\n${JSON.stringify(o)}\n\`\`\``;

Deno.test('VIS04-1 : bloc de brief — `projet` et `vues` relus ; vues hors catalogue ou pour un film refusées ; ancien bloc inchangé', () => {
  const p = briefProjet();
  const lu = briefDuMessage(bloc({ v: 1, type: 'image', brief: { a_toi_de_choisir: true }, projet: p, vues: ['aerienne', 'trois_quarts_gauche'] }));
  na.ok(lu?.ok);
  if (!lu?.ok) return;
  na.deepEqual(lu.valeur.vues, ['aerienne', 'trois_quarts_gauche']);
  na.equal(empreinteChamps(lu.valeur.projet), empreinteChamps(p));
  na.match(String((briefDuMessage(bloc({ v: 1, type: 'image', brief: { a_toi_de_choisir: true }, vues: ['vue_mer'] })) as { erreur: string }).erreur), /vues illisibles/);
  na.match(String((briefDuMessage(bloc({ v: 1, type: 'film', brief: { a_toi_de_choisir: true }, vues: ['face'] })) as { erreur: string }).erreur), /que pour une image/);
  na.match(String((briefDuMessage(bloc({ v: 1, type: 'image', brief: { a_toi_de_choisir: true }, projet: { autre: 1 } })) as { erreur: string }).erreur), /brief du projet illisible/);
  const ancien = briefDuMessage(bloc({ v: 1, type: 'image', brief: { a_toi_de_choisir: true } }));
  na.ok(ancien?.ok && !('projet' in ancien.valeur) && !('vues' in ancien.valeur));
});

Deno.test('VIS04-2 : options image — vues du catalogue livrées (1 à 6), crépuscule ; options d’avant inchangées', () => {
  // VIS-14 (I2) : ambiance non choisie → NON transmise (le worker applique celle du brief projet, sinon « jour »).
  na.deepEqual(validerOptionsRendu('image', {}), { ok: true, valeur: { vues: ['trois_quarts_gauche'] } });
  na.deepEqual(validerOptionsRendu('image', { vues: ['aerienne', 'face'], ambiance: 'crepuscule' }), { ok: true, valeur: { vues: ['face', 'aerienne'], ambiance: 'crepuscule' } });
  // VIS-10 : privatifs « sous condition » acceptés (le worker refuse avec sa raison) ; hall toujours « bientôt ».
  na.equal(validerOptionsRendu('image', { vues: ['terrasse'] }).ok, true, 'privatif sous condition');
  na.equal(validerOptionsRendu('image', { vues: ['hall'] }).ok, false, 'hall pas encore livré');
  na.equal(validerOptionsRendu('image', { vues: ['face', 'aerienne', 'entree', 'angle_rue', 'coeur_ilot', 'trois_quarts_gauche', 'trois_quarts_droite'] }).ok, false, '7 vues');
  na.equal(validerOptionsRendu('image', { ambiance: 'nuit' }).ok, false);
});

Deno.test('VIS04-3 : fiche — sans brief projet, strictement identique ; avec, le contrat v2 porte brief, rendu, typologies', () => {
  const t = '2026-11-18T12:00:00.000Z';
  const s = '11111111-2222-4333-8444-555555555555';
  const a = ficheDepuisPreparation(PREPARATION_AE0414, CONV, t, s, 'https://mimmoza.vercel.app', null, null);
  const b = ficheDepuisPreparation(PREPARATION_AE0414, CONV, t, s, 'https://mimmoza.vercel.app', null, null, { briefProjet: null });
  na.deepEqual(JSON.stringify(a), JSON.stringify(b));
  na.ok(a.ok && !('brief' in (a.valeur.charge as Record<string, unknown>)));
  const c = ficheDepuisPreparation(PREPARATION_AE0414, CONV, t, s, 'https://mimmoza.vercel.app', null, null, { briefProjet: briefProjet() });
  na.ok(c.ok, c.ok ? '' : c.erreur);
  if (!c.ok) return;
  const charge = c.valeur.charge as Record<string, unknown>;
  const lu = validerProjet(charge);
  na.ok(lu.ok);
  if (!lu.ok) return;
  na.equal(lu.projet.brief?.gamme, 'premium');
  na.equal(lu.projet.brief?.materiaux[0]?.libelle, 'brique claire');
  na.deepEqual(lu.projet.rendu?.vues, ['trois_quarts_gauche', 'aerienne', 'terrasse']);
  na.deepEqual(lu.projet.programme.typologies, [{ type: 'T2', nombre: 10, shabM2: 48 }, { type: 'T3', nombre: 6, shabM2: 66 }]);
  // Géométrie inchangée par le brief.
  na.deepEqual((charge as { batiments: unknown }).batiments, (a.ok ? a.valeur.charge as { batiments: unknown } : { batiments: null }).batiments);
  const refuse = ficheDepuisPreparation(PREPARATION_AE0414, CONV, t, s, 'https://mimmoza.vercel.app', null, null, { briefProjet: { rendu: { vues: ['vue_mer'] } } as unknown as ChampsContratBrief });
  na.equal(refuse.ok, false);
});

Deno.test('VIS04-4 : devis puis confirmation — vues cochées (bientôt dites), brief projet dans le jeton, fiche du travail ; brief introuvable → rien lancé', async () => {
  const d = await depotPrepare();
  const p = briefProjet();
  // VIS-10 : « hall » reste la seule vue « bientôt » (terrasse est désormais « sous condition »).
  const texte = bloc({ v: 1, type: 'image', brief: { facade: 'brique', teinte: 'claire' }, projet: p, vues: ['trois_quarts_gauche', 'aerienne', 'hall'] });
  d.messages = [{ texte, cree_le: '2026-11-18T12:00:00.000Z' }];
  const devis = await executerOutilStudio('studio_lancer_rendu', { type: 'image' }, env(d, 'R1', { briefCarte: briefDuMessage(texte) }));
  na.equal(devis?.status, 'confirmation_requise', devis?.message);
  const data = devis!.data as { options: { vues: string[] }; devis: { avertissements: string[]; brief_projet?: string } };
  na.deepEqual(data.options.vues, ['trois_quarts_gauche', 'aerienne']);
  na.ok(data.devis.avertissements.some((x) => /hall — non incluses/.test(x)), data.devis.avertissements.join(' | '));
  na.match(String(data.devis.brief_projet), /gamme premium/);
  d.appels.push(devis as unknown as Record<string, unknown>);
  const ok = await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env(d, 'R2'));
  na.equal(ok?.status, 'ok', ok?.message);
  const t = d.travaux.at(-1)!;
  na.deepEqual(t.options.vues, ['trois_quarts_gauche', 'aerienne']);
  const charge = (t.fiche as { charge: { brief?: { gamme: string }; rendu?: unknown } }).charge;
  na.equal(charge.brief?.gamme, 'premium');
  na.ok(charge.rendu);

  // Même devis, mais le message du brief projet n'est plus dans le fil : rien n'est lancé.
  const d2 = await depotPrepare();
  d2.messages = [{ texte, cree_le: '2026-11-18T12:00:00.000Z' }];
  const devis2 = await executerOutilStudio('studio_lancer_rendu', { type: 'image' }, env(d2, 'R1', { briefCarte: briefDuMessage(texte) }));
  d2.appels.push(devis2 as unknown as Record<string, unknown>);
  d2.messages = [];
  const refus = await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env(d2, 'R2'));
  na.equal(refus?.status, 'error');
  na.match(String(refus?.message), /brief du projet de ce devis n’est plus lisible/);
  na.equal(d2.travaux.length, 0);
});

// ── VIS-10 (19/11/2026) — option `livraison` et pronostic des vues « sous condition » dans le devis ─────────────

Deno.test('VIS10-1 : options image — `livraison` admise et recopiée validée ; refus motivé ; sans elle, options inchangées', () => {
  na.deepEqual(validerOptionsRendu('image', { vues: ['face'], livraison: { formats: ['web_16_9', 'vignette'], credit: null } }),
    { ok: true, valeur: { vues: ['face'], livraison: { formats: ['web_16_9', 'vignette'], credit: null } } });
  na.deepEqual(validerOptionsRendu('image', { vues: ['face'] }), { ok: true, valeur: { vues: ['face'] } });
  const ko = validerOptionsRendu('image', { vues: ['face'], livraison: { formats: ['poster'] } });
  na.equal(ko.ok, false);
  na.match((ko as { erreur: string }).erreur, /formats connus/);
  na.equal(validerOptionsRendu('film', { livraison: { active: true } }).ok, false, 'image seulement');
});

Deno.test('VIS10-2 : devis — vues sous condition produites selon le projet, pronostic d’après l’habillage (balcons « aucun »)', async () => {
  const d = await depotPrepare();
  const texte = bloc({ v: 1, type: 'image', brief: { facade: 'brique', balcons: 'aucun' }, vues: ['trois_quarts_gauche', 'balcon', 'sejour'] });
  d.messages = [{ texte, cree_le: '2026-11-19T08:00:00.000Z' }];
  const devis = await executerOutilStudio('studio_lancer_rendu', { type: 'image' }, env(d, 'R10', { briefCarte: briefDuMessage(texte) }));
  na.equal(devis?.status, 'confirmation_requise', devis?.message);
  const data = devis!.data as { options: { vues: string[] }; devis: { avertissements: string[] }; pronostic_vues?: { vue: string; pronostic: string }[] };
  na.deepEqual(data.options.vues, ['trois_quarts_gauche', 'balcon', 'sejour'], 'les vues sous condition partent (le worker tranche)');
  na.deepEqual(data.pronostic_vues?.map((p) => [p.vue, p.pronostic]), [['balcon', 'probablement_refusee'], ['sejour', 'selon_projet']]);
  na.ok(data.devis.avertissements.some((x) => /« Balcon » : sera probablement refusée/.test(x)), data.devis.avertissements.join(' | '));
  na.ok(data.devis.avertissements.some((x) => /« Séjour » : selon le projet/.test(x)), data.devis.avertissements.join(' | '));
});

Deno.test('VIS10-3 : confirmation — l’image (qualité finale par défaut) part avec livraison: {active: true} ; le devis reste sans', async () => {
  const d = await depotPrepare();
  const texte = bloc({ v: 1, type: 'image', brief: { facade: 'brique' }, vues: ['trois_quarts_gauche', 'aerienne'] });
  d.messages = [{ texte, cree_le: '2026-11-19T09:00:00.000Z' }];
  const devis = await executerOutilStudio('studio_lancer_rendu', { type: 'image' }, env(d, 'R20', { briefCarte: briefDuMessage(texte) }));
  na.equal(devis?.status, 'confirmation_requise', devis?.message);
  na.equal('livraison' in (devis!.data as { options: Record<string, unknown> }).options, false, 'devis : options inchangées');
  d.appels.push(devis as unknown as Record<string, unknown>);
  const ok = await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env(d, 'R21'));
  na.equal(ok?.status, 'ok', ok?.message);
  const t = d.travaux.at(-1)!;
  na.deepEqual(t.options.livraison, { active: true });
  na.deepEqual(t.options.vues, ['trois_quarts_gauche', 'aerienne']);
});
