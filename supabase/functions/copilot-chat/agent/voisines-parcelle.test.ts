// deno test --no-lock --no-check -A supabase/functions/copilot-chat/agent/voisines-parcelle.test.ts
// Lot C7b : parcelles voisines, côté voie et bandes côté serveur. Hors ligne : le réseau est simulé avec les
// géométries RÉELLES du cadastre relevées le 10/11/2026 (parcelle 93048000AS0249, 98 rue de Paris, Montreuil,
// et ses cinq voisines — fixture du lot C7a).
import * as na from 'node:assert/strict';
import { chercherContourParcelle } from './conception.ts';
import { lireRegles, preparerVolume, reglesVolume, type ConceptionLue } from './studio.ts';
import {
  bandesDeLaConception, chercherVoisinesParcelle, empriseElargie, LIMITE_VOISINES, lireVoisines, noteBandesNonMesurees,
} from './voisines-parcelle.ts';
import { empriseMaxParBande } from '../../../../src/spaces/copilot/studio3d/coteVoie.ts';

const IDU = '93048000AS0249';
const FX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/cadastre-93048000AS0249.json', import.meta.url)));
type P = { idu: string; contenance?: number; geometry: unknown };
const feature = (p: P) => ({ type: 'Feature', geometry: p.geometry, properties: { idu: p.idu, ...(p.contenance ? { contenance: p.contenance } : {}) } });
const TOUTES = [FX.parcelle, ...FX.voisines].map(feature);

/** Faux cadastre : la requête par identifiant rend la parcelle, la requête par emprise (geom=) rend `voisinage()`. */
function fauxCadastre(voisinage: () => Response | Promise<Response>) {
  const urls: string[] = [];
  const f = (async (u: string) => {
    urls.push(String(u));
    if (String(u).includes('geom=')) return await voisinage();
    return new Response(JSON.stringify({ type: 'FeatureCollection', features: [feature(FX.parcelle)] }));
  }) as unknown as typeof fetch;
  return { f, urls };
}
const collection = (features: unknown[]) => new Response(JSON.stringify({ type: 'FeatureCollection', features }));

// Règles du PLUi Est Ensemble telles que le lot C6 les enregistre (indices J et b2, mission du 10/11/2026).
const REGLES = [
  { cle: 'emprise_sol_max_pct', valeur: 80, statut: 'confirme', source: 'Règlement GPU — PLUi Est Ensemble', article: 'indice J', nature: 'alternative',
    texte: 'selon la bande', alternatives: [{ libelle: 'bande principale (18 m)', valeur: 80 }, { libelle: 'bande secondaire', valeur: 20 }] },
  { cle: 'hauteur_max_m', valeur: 19.5, statut: 'confirme', source: 'Règlement GPU — PLUi Est Ensemble', article: 'indice b2, p. 263', nature: 'alternative',
    alternatives: [{ libelle: 'bande principale (18 m)', valeur: 19.5 }, { libelle: 'bande secondaire', valeur: 13.5 }] },
  { cle: 'niveaux_max', valeur: 6, statut: 'confirme', source: 'Règlement GPU — PLUi Est Ensemble', article: 'indice b2, p. 263', nature: 'alternative',
    alternatives: [{ libelle: 'bande principale (18 m)', valeur: 6 }, { libelle: 'bande secondaire', valeur: 4 }] },
];
const conception = (parcelle: unknown, regles: unknown = REGLES): ConceptionLue =>
  ({ id: 'c-montreuil', idu: IDU, commune: 'Montreuil', parcelle, regles_plu: regles, programme: { nb_logements: 30 } }) as ConceptionLue;

async function parcelleReelle() {
  const { f, urls } = fauxCadastre(() => collection(TOUTES));
  const p = await chercherContourParcelle(IDU, f);
  na.ok(p);
  return { p: p!, urls };
}

Deno.test('C7b-1 : contour + voisines en deux requêtes au cadastre ; la parcelle elle-même est écartée', async () => {
  const { p, urls } = await parcelleReelle();
  na.equal(urls.length, 2);
  na.ok(urls[0].includes('code_insee=93048') && urls[0].includes('section=AS') && urls[0].includes('numero=0249'));
  const u = new URL(urls[1]);
  na.equal(u.origin + u.pathname, 'https://apicarto.ign.fr/api/cadastre/parcelle');
  na.equal(u.searchParams.get('_limit'), String(LIMITE_VOISINES));
  // L'emprise demandée est le rectangle englobant de la parcelle, élargi de 2 m : il contient tous ses sommets.
  const rect = JSON.parse(u.searchParams.get('geom')!);
  na.deepEqual(rect, empriseElargie(FX.parcelle.geometry)!);
  const [o, s] = rect.coordinates[0][0], [e, n] = rect.coordinates[0][2];
  for (const [lon, lat] of FX.parcelle.geometry.coordinates[0][0]) na.ok(lon > o && lon < e && lat > s && lat < n);
  na.ok((n - s) * 111_320 - (48.85711734 - 48.85675622) * 111_320 > 3.9, 'marge de 2 m de chaque côté');
  na.equal(p.surface_m2, 804);
  na.equal(p.voisines?.statut, 'disponibles');
  na.deepEqual(p.voisines?.parcelles.map((v) => v.idu), ['93048000AS0107', '93048000AS0108', '93048000AS0215', '93048000AS0239', '93048000AS0248']);
  na.deepEqual(p.voisines?.parcelles[0].geometrie, FX.voisines[0].geometry, 'géométrie conservée telle que reçue');
  na.match(p.voisines!.source, /API Carto IGN/);
});

Deno.test('C7b-2 : parcelle réelle — côté voie 28,65 m, bande principale 461 m², secondaire 355 m², emprise max 439 m²', async () => {
  const { p } = await parcelleReelle();
  const b = bandesDeLaConception(p, lireRegles(REGLES));
  na.equal(b.applicable, true);
  na.equal(b.raison, null);
  na.equal(b.profondeurM, 18);
  na.equal(b.coteVoie?.statut, 'identifie');
  na.equal(b.coteVoie?.nbVoisines, 5);
  na.ok(Math.abs(b.coteVoie!.longueurFacadeM - 28.65) < 0.05, String(b.coteVoie!.longueurFacadeM));
  na.deepEqual(b.mesure, { profondeurM: 18, surfaceParcelleM2: 816, bandePrincipaleM2: 461, bandeSecondaireM2: 355 });
  // Plafond réglementaire des deux bandes (indice J : 80 % / 20 %) : 368 + 71 = 439 m².
  na.deepEqual(empriseMaxParBande(b.mesure!, 80, 20), { principaleM2: 368, secondaireM2: 71, totalM2: 439, tauxParcellePct: 53.8 });
  na.equal(noteBandesNonMesurees(b), null);
});

Deno.test('C7b-3 : les voisines survivent à l’enregistrement (JSON) et donnent la même mesure', async () => {
  const { p } = await parcelleReelle();
  const relue = JSON.parse(JSON.stringify(p));
  na.ok(JSON.stringify(p).length < 20_000, 'taille de la parcelle enregistrée');
  na.deepEqual(lireVoisines(relue), p.voisines);
  na.deepEqual(bandesDeLaConception(relue, lireRegles(REGLES)).mesure, { profondeurM: 18, surfaceParcelleM2: 816, bandePrincipaleM2: 461, bandeSecondaireM2: 355 });
});

Deno.test('C7b-4 : préparation du volume — emprise 45 % (bande principale mesurée) au lieu de 20 %, dite dans les notes', async () => {
  const { p } = await parcelleReelle();
  const avec = await preparerVolume(conception(p));
  const sans = await preparerVolume(conception({ ...p, voisines: undefined }));
  na.ok(avec.ok && sans.ok);
  if (!avec.ok || !sans.ok) return;
  na.ok(avec.resume.regles_appliquees.some((l) => /Emprise au sol \(CES\) : 45 %/.test(l) && /461 m² mesurés depuis le côté voie présumé/.test(l)), avec.resume.regles_appliquees.join(' | '));
  na.ok(avec.resume.regles_non_appliquees.some((l) => l.startsWith('Emprise par bande : 80 % de la bande principale (461 m² à moins de 18 m de la voie) = 368 m², soit 45 % de la parcelle de 816 m²')));
  na.ok(avec.resume.regles_non_appliquees.some((l) => l.startsWith('Bande secondaire (355 m², emprise 20 %) : non construite')));
  na.ok(avec.resume.regles_non_appliquees.some((l) => l.startsWith('Côté voie présumé d’après le cadastre')));
  na.ok(!avec.resume.regles_non_appliquees.some((l) => /SOUS-ESTIME|Côté voie non situé/.test(l)));
  na.deepEqual(avec.entree.bandes, { profondeurM: 18, surfaceParcelleM2: 816, bandePrincipaleM2: 461, bandeSecondaireM2: 355 });
  // Le plafond n'est jamais dépassé, et le volume ne perd rien à être moins bridé.
  na.ok(avec.resume.emprise_batie_m2 <= 368, String(avec.resume.emprise_batie_m2));
  na.ok(avec.resume.emprise_batie_m2 >= sans.resume.emprise_batie_m2);
  na.ok(avec.resume.sdp_estimee_m2 >= sans.resume.sdp_estimee_m2);
  // Les voisines ne sont pas recopiées dans l'entrée de la préparation (seule la mesure y entre).
  na.equal((avec.entree.parcelle as unknown as Record<string, unknown>).voisines, undefined);
  na.notEqual(avec.empreinte, sans.empreinte);
  // Déterministe.
  na.equal((await preparerVolume(conception(JSON.parse(JSON.stringify(p))))).ok && avec.empreinte, ((await preparerVolume(conception(p))) as { empreinte: string }).empreinte);
});

Deno.test('C7b-5 : conception sans voisines (avant le lot) — comportement C6 inchangé, raison dite, même empreinte', async () => {
  const { p } = await parcelleReelle();
  const { voisines: _v, ...ancienne } = p;
  const r = await preparerVolume(conception(ancienne));
  na.ok(r.ok);
  if (!r.ok) return;
  na.ok(r.resume.regles_appliquees.some((l) => /Emprise au sol \(CES\) : 20 %/.test(l) && /côté voie non identifié : taux le plus contraignant/.test(l)));
  na.ok(r.resume.regles_non_appliquees.some((l) => /SOUS-ESTIME/.test(l)));
  na.ok(r.resume.regles_non_appliquees.some((l) => l.startsWith('Côté voie non situé — Parcelles voisines absentes de cette conception')));
  na.equal('bandes' in r.entree, false);
  // Mêmes règles du volume qu'un appel sans bandes (lot C6) ; même empreinte quelle que soit la raison de l'absence.
  na.deepEqual(reglesVolume(lireRegles(REGLES), null, bandesDeLaConception(ancienne, lireRegles(REGLES)).mesure), reglesVolume(lireRegles(REGLES), null));
  const indispo = await preparerVolume(conception({ ...ancienne, voisines: { statut: 'indisponibles', parcelles: [], source: 's', raison: 'Le cadastre n’a pas répondu.' } }));
  na.ok(indispo.ok && indispo.empreinte === r.empreinte);
  na.ok(indispo.ok && indispo.resume.regles_non_appliquees.includes('Côté voie non situé — Le cadastre n’a pas répondu.'));
});

Deno.test('C7b-6 : cadastre en panne, liste tronquée ou douteuse → contour gardé, voisines « indisponibles » avec la raison', async () => {
  const cas: Array<[string, () => Response | Promise<Response>, RegExp]> = [
    ['erreur 500', () => new Response('non', { status: 500 }), /a refusé la demande des parcelles voisines \(réponse 500\)/],
    ['pas de réponse', () => { throw new Error('délai'); }, /n’a pas répondu/],
    ['réponse illisible', () => new Response('{"erreur":true}'), /illisible/],
    ['liste tronquée', () => collection(Array.from({ length: LIMITE_VOISINES }, (_, i) => feature({ ...FX.voisines[i % 5], idu: `93048000AS${String(1000 + i)}` }))), /possiblement incomplète/],
    ['voisine sans contour', () => collection([...TOUTES, { type: 'Feature', geometry: null, properties: { idu: '93048000AS0999' } }]), /contour illisible/],
    ['aucune voisine', () => collection([feature(FX.parcelle)]), /aucune parcelle voisine/],
  ];
  for (const [nom, rep, attendu] of cas) {
    const { f } = fauxCadastre(rep);
    const p = await chercherContourParcelle(IDU, f);
    na.equal(p?.surface_m2, 804, nom);
    na.equal(p?.voisines?.statut, 'indisponibles', nom);
    na.deepEqual(p?.voisines?.parcelles, [], nom);
    na.match(p!.voisines!.raison!, attendu, nom);
    const b = bandesDeLaConception(p, lireRegles(REGLES));
    na.equal(b.mesure, null, nom);
    na.equal(b.raison, p!.voisines!.raison, nom);
    const r = await preparerVolume(conception(p));
    na.ok(r.ok && r.resume.regles_appliquees.some((l) => /Emprise au sol \(CES\) : 20 %/.test(l)), nom);
    na.ok(r.ok && r.resume.regles_non_appliquees.includes(`Côté voie non situé — ${p!.voisines!.raison}`), nom);
  }
  // Contour illisible : aucune requête.
  let appels = 0;
  const v = await chercherVoisinesParcelle(IDU, { type: 'Polygon', coordinates: [] }, (async () => { appels++; return collection([]); }) as unknown as typeof fetch);
  na.equal(v.statut, 'indisponibles');
  na.equal(appels, 0);
});

Deno.test('C7b-7 : côté voie non identifié ou profondeur non lue → aucune mesure, raison dite ; sans règle par bande → rien', async () => {
  const { p } = await parcelleReelle();
  // Parcelle « enclavée » (cas construit) : une fausse voisine suit le contour à 0,2 m, toutes les limites deviennent mitoyennes.
  const decale = { type: 'Polygon' as const, coordinates: [(FX.parcelle.geometry.coordinates[0][0] as number[][]).map(([lon, lat]) => [lon, lat + 0.2 / 111_320])] };
  const enclavee = { ...p, voisines: { ...p.voisines!, parcelles: [...p.voisines!.parcelles, { idu: null, geometrie: decale }] } };
  const b1 = bandesDeLaConception(enclavee, lireRegles(REGLES));
  na.equal(b1.mesure, null);
  na.equal(b1.coteVoie?.statut, 'aucune_facade');
  na.match(b1.raison!, /Aucune limite libre de voisine/);
  // Profondeur non écrite dans la règle : jamais supposée.
  const sansProfondeur = REGLES.map((r) => r.cle === 'emprise_sol_max_pct' ? { ...r, alternatives: [{ libelle: 'bande principale', valeur: 80 }, { libelle: 'bande secondaire', valeur: 20 }] } : r);
  const b2 = bandesDeLaConception(p, lireRegles(sansProfondeur));
  na.equal(b2.mesure, null);
  na.match(b2.raison!, /Profondeur de la bande principale non lue/);
  const r2 = await preparerVolume(conception(p, sansProfondeur));
  na.ok(r2.ok && r2.resume.regles_appliquees.some((l) => /Emprise au sol \(CES\) : 20 %/.test(l)));
  na.ok(r2.ok && r2.resume.regles_non_appliquees.some((l) => /^Côté voie non situé — Profondeur de la bande principale non lue/.test(l)));
  // Règle d'emprise ordinaire (pas par bande) : le lot ne change rien, voisines ou non.
  const ordinaires = [{ cle: 'emprise_sol_max_pct', valeur: 50, statut: 'confirme', source: 'Règlement', article: 'UC 9' }];
  const b3 = bandesDeLaConception(p, lireRegles(ordinaires));
  na.deepEqual([b3.applicable, b3.mesure, b3.raison], [false, null, null]);
  const { voisines: _v, ...ancienne } = p;
  const a = await preparerVolume(conception(p, ordinaires)), s = await preparerVolume(conception(ancienne, ordinaires));
  na.ok(a.ok && s.ok && a.empreinte === s.empreinte);
  na.ok(a.ok && s.ok && JSON.stringify(a.volume) === JSON.stringify(s.volume));
});

Deno.test('C7b-8 : lecture tolérante des voisines enregistrées', () => {
  na.equal(lireVoisines(null), null);
  na.equal(lireVoisines({ idu: IDU }), null);
  na.equal(lireVoisines({ voisines: 'x' })?.statut, 'indisponibles');
  na.equal(lireVoisines({ voisines: { statut: 'disponibles', parcelles: [] } })?.statut, 'indisponibles');
  na.equal(lireVoisines({ voisines: { statut: 'disponibles', parcelles: [{ idu: 'A', geometrie: { type: 'Polygon', coordinates: [[[1, 2]]] } }] } })?.statut, 'indisponibles');
  na.equal(lireVoisines({ voisines: { statut: 'indisponibles' } })?.raison, 'Parcelles voisines indisponibles (raison non enregistrée).');
  const ok = lireVoisines({ voisines: { statut: 'disponibles', source: 'S', parcelles: FX.voisines.map((v: P) => ({ idu: v.idu, geometrie: v.geometry })) } });
  na.equal(ok?.statut, 'disponibles');
  na.equal(ok?.parcelles.length, 5);
});
