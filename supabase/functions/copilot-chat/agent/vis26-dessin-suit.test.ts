// deno test --no-lock --no-check -A supabase/functions/copilot-chat/agent/vis26-dessin-suit.test.ts
// VIS-26 lot D — la 3D préparée du chat RESSEMBLE au dessin : emprise = plan du volume principal (plafonnée par le moteur :
// parcelle, reculs, emprise permise), niveaux du dessin plafonnés ; les écarts restent DITS. Code réel de studio.ts.
// Conception : celle de dessin-batiment-rendu.test.ts (AE0414, géométrie synthétique 50 × 40 m, gabarit R+4).
import * as na from 'node:assert/strict';
import { executerOutilDessinerBatiment } from './dessin-batiment.ts';
import { appliquerChoixForme, executerOutilStudio, preparerVolume, type ConceptionLue, type DepotStudio } from './studio.ts';
import { empreinteModele, type ModeleBatiment } from '../../../../src/lib/studio/modeleBatiment.ts';
import { EXEMPLE_MAISON_BASQUE } from '../../../../src/lib/studio/modeleBatimentExemples.ts';
import { messageReproduireModele, referenceModeleDuMessage } from '../../../../src/lib/studio/modeleBatimentMessage.ts';
import { saisieDepuisVolume } from '../../../../src/spaces/copilot/studio3d/ficheDimensions.ts';
import { appliquerSecteursDeclares, completerRegles, reglesDepuisLecture, type RegleConception } from './conception.ts';

globalThis.fetch = (() => { throw new Error('RÉSEAU INTERDIT EN TEST'); }) as typeof fetch;
const ok = (v: unknown, m?: string) => na.ok(v, m);
const eq = (a: unknown, b: unknown, m?: string) => na.deepStrictEqual(a, b, m);

const SOURCE = 'Règlement GPU — 92050_PLU_20251209';
const IDU = '92050000AE0414';
const USER = '0d6f1a2b-0000-4000-8000-000000000001';
const CONV = '7c0f0000-0000-4000-8000-0000000000aa';
function reglesAE0414(): RegleConception[] {
  const lues = reglesDepuisLecture({ regles: [
    { cle: 'emprise_sol_max_pct', nature: 'non_reglementee', valeur: null, article: 'UC 9, p. 109', texte: 'Il n’est pas fixé de règle.' },
    { cle: 'hauteur_max_m', nature: 'par_secteur', valeur: null, article: 'UC 10, p. 109', regle_relative: 'UC 10-1 : hauteur ≤ distance à l’alignement opposé + 2 m',
      valeurs_par_secteur: [{ secteur: '1', acrotere_terrasse: 28, egout: 26, faitage: 28, texte: '28 m à l’acrotère (toiture terrasse)' }] },
    { cle: 'recul_voie_m', nature: 'alternative', valeur: null, article: 'UC 6-1, p. 106', texte: 'implantation à l’alignement ou en recul minimum de 4 m',
      alternatives: [{ libelle: 'alignement', valeur: 0 }, { libelle: 'recul minimum', valeur: 4 }] },
    { cle: 'recul_limites_m', valeur: 8, article: 'UC 7', texte: '8 m (3 m en l’absence de baie)' },
    { cle: 'pleine_terre_min_pct', valeur: 20, article: 'UC 13', texte: '20 % de pleine terre' },
  ] }, 'gpu', SOURCE);
  return completerRegles(appliquerSecteursDeclares(lues, { hauteur: '1', stationnement: '3', toiture: 'terrasse' }).regles);
}
const LON = 2.2068, LAT = 48.892, KX = 111_320 * Math.cos(LAT * Math.PI / 180);
function rectangle(l: number, h: number) {
  const ring = [[0, 0], [l, 0], [l, h], [0, h]].map(([x, y]) => [LON + x / KX, LAT + y / 111_320]);
  return { type: 'Polygon' as const, coordinates: [[...ring, ring[0]]] };
}
function conception(): ConceptionLue {
  return {
    id: '5a1c0e00-0000-4000-8000-0000000000c1', idu: IDU, commune: 'Nanterre',
    parcelle: { idu: IDU, geometrie: rectangle(50, 40), surface_m2: 2000, source: 'synthétique (test)' },
    regles_plu: reglesAE0414(),
    programme: { nb_logements: 40, typologies: {}, shab_cible_m2: null, sdp_cible_m2: null, gabarit: 'R+4', stationnement: null, toiture: 'terrasse' },
  };
}

type Emprise = { largeurM: number; profondeurM: number };
const tri = (e: Emprise) => [Math.max(e.largeurM, e.profondeurM), Math.min(e.largeurM, e.profondeurM)];

function dessinDe(transformer: (m: typeof EXEMPLE_MAISON_BASQUE) => unknown) {
  const sortie = executerOutilDessinerBatiment({ modele: transformer(EXEMPLE_MAISON_BASQUE) }, { photoAuTour: false });
  na.equal(sortie.status, 'ok', sortie.message);
  return { sortie, modele: (sortie.data as { modele: ModeleBatiment }).modele };
}

async function preparerDepuisDessin(d: ReturnType<typeof dessinDe>) {
  const texte = messageReproduireModele(d.modele, empreinteModele(d.modele));
  let preparee: { volume: { emprise: Emprise; niveaux: number; batiments?: unknown[] | null } } | null = null;
  const depot = {
    conception: () => Promise.resolve(conception()),
    enregistrerPreparation: (_u: string, l: never) => { preparee = l; return Promise.resolve('9b000000-0000-4000-8000-000000000003'); },
    briefsMessages: () => Promise.resolve([{ texte, cree_le: '2026-11-24T10:00:00Z' }]),
    sortiesModele: () => Promise.resolve([d.sortie]),
    sortiesExtension: () => Promise.resolve([]), sortiesMaison: () => Promise.resolve([]), dernierParcours: () => Promise.resolve(null),
  } as unknown as DepotStudio;
  const { descriptionDuMessage } = await import('../../../../src/lib/studio/descriptionBatiment.ts');
  const r = await executerOutilStudio('studio_preparer_3d', {}, {
    userId: USER, depot, secret: 's', requete: crypto.randomUUID(), conversationId: CONV, origine: 'https://mimmoza.vercel.app',
    batimentCarte: descriptionDuMessage(texte), modeleCarte: referenceModeleDuMessage(texte),
  });
  ok(r && r.status === 'ok', JSON.stringify(r?.message));
  ok(preparee, 'préparation enregistrée');
  const bd = (r!.data as Record<string, unknown>).batiment_decrit as { ecarts: string[]; modele: { ecarts: string[] } };
  return { volume: preparee!.volume, bd };
}

Deno.test('3D préparée : la maison basque dessinée (12 × 10 m, R+1) donne une emprise de 12 × 10 m et 2 niveaux', async () => {
  const sans = await preparerVolume(conception(), {});
  ok(sans.ok);
  const moteur = (sans as unknown as { volume: { emprise: Emprise } }).volume.emprise;
  ok(tri(moteur)[0] > 12.5, `le moteur seul propose plus grand (${JSON.stringify(tri(moteur))})`);
  const { volume, bd } = await preparerDepuisDessin(dessinDe((m) => m));
  eq(tri(volume.emprise), [12, 10], JSON.stringify(volume.emprise));
  eq(volume.niveaux, 2);
  ok(!bd.modele.ecarts.some((e) => /^Emprise/.test(e)), bd.modele.ecarts.join(' | '));
  ok(bd.modele.ecarts.some((e) => /reprend le plan et la hauteur du volume principal/.test(e) && /volume d’étude simple/.test(e)), bd.modele.ecarts.join(' | '));
});

Deno.test('3D préparée : dessin trop grand et trop haut → emprise et niveaux plafonnés par le moteur, écarts DITS', async () => {
  const geant = dessinDe((m) => ({ ...m, volumes: m.volumes.map((v) => (v.id === 'principal' ? { ...v, niveaux: 9, plan: { type: 'rectangle', largeur: 80, profondeur: 35 } } : v)) }));
  const moteur = await preparerVolume(conception(), { niveaux: 9 });
  ok(moteur.ok);
  const em = (moteur as unknown as { volume: { emprise: Emprise; niveaux: number } }).volume;
  const { volume, bd } = await preparerDepuisDessin(geant);
  ok(tri(volume.emprise)[0] <= tri(em.emprise)[0] + 1e-6 && tri(volume.emprise)[1] <= tri(em.emprise)[1] + 1e-6, `${JSON.stringify(volume.emprise)} ≤ ${JSON.stringify(em.emprise)}`);
  ok(volume.niveaux <= 5, `gabarit R+4 : ${volume.niveaux}`);
  ok(bd.modele.ecarts.some((e) => /^Emprise : le volume principal dessiné fait 80 × 35 m ; la 3D préparée est ramenée à/.test(e)), bd.modele.ecarts.join(' | '));
  ok(bd.modele.ecarts.some((e) => /^Hauteur : le dessin monte à R\+8/.test(e)), bd.modele.ecarts.join(' | '));
});

Deno.test('choix de forme : le plan du dessin est ignoré avec une saisie de la fiche et ne sort jamais du bâtiment du moteur', async () => {
  const p = await preparerVolume(conception(), {});
  ok(p.ok);
  const v = (p as unknown as { volume: never }).volume;
  const pf = { idu: IDU, commune: 'Nanterre', volume: v, regles: reglesAE0414(), programme: undefined, gabaritNiveaux: 5 } as never;
  const r = appliquerChoixForme(pf, { dessin: { largeurM: 9, profondeurM: 14 } });
  ok(r.ok);
  if (!r.ok) return;
  eq(tri((r.volume as { emprise: Emprise }).emprise), [14, 9]);
  ok(r.cle, 'empreinte de la préparation distincte de celle du moteur');
  const minuscule = appliquerChoixForme(pf, { dessin: { largeurM: 3, profondeurM: 3 } });
  ok(minuscule.ok && tri((minuscule.volume as { emprise: Emprise }).emprise)[1] >= 6, 'côté minimal du moteur (6 m)');
  // Forme et dimensions choisies dans la fiche : elles passent avant le dessin.
  const fiche = appliquerChoixForme(pf, { saisie: saisieDepuisVolume(v), dessin: { largeurM: 9, profondeurM: 14 } });
  ok(fiche.ok);
  eq(tri((fiche as { volume: { emprise: Emprise } }).volume.emprise), tri((v as { emprise: Emprise }).emprise));
});
