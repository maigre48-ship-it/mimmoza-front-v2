// src/lib/quartier/quartier.test.ts — VIS-70 : atouts du quartier (npx tsx --test src/lib/quartier/quartier.test.ts)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assemblerAtouts, lieuxDepuisBpe, lieuxDepuisMobilite, lieuxDepuisSirene, lireAtouts, nomLisible, type EtatSource } from './atoutsQuartier.ts';
import { lieuxDepuisOverpass, requeteOverpass } from './overpassQuartier.ts';
import { classerBpe, classerOsm, CATEGORIES_QUARTIER } from './categoriesQuartier.ts';
import { distanceM, minutesPied, minutesTransport, minutesVelo, rayonIsochroneM, libelleDistance, cercleGeoJson } from './tempsTrajet.ts';
import { lignesSynthese, lireCarteQuartier, texteDossierQuartier, OUTIL_QUARTIER_VENTE, CARTE_QUARTIER } from './texteAtouts.ts';
import { adressePageQuartier, construireMenuVente, lienGrilleVente, vueDepuisAdresse } from './navigationVente.ts';
import { collecterLivrables } from '../studio/dossierClient/dossierClientLogique.ts';
import * as F from './__fixtures__/quartierFixtures.ts';

const TOUS_OK: EtatSource[] = [{ source: 'bpe', ok: true }, { source: 'mobilite', ok: true }, { source: 'osm', ok: true }, { source: 'sirene', ok: true }];
const QUAND = new Date('2026-11-27T10:00:00Z');

function ascain(etats = TOUS_OK, osm: unknown = F.OSM_ASCAIN_DEMO) {
  return assemblerAtouts(F.ASCAIN, [
    ...lieuxDepuisBpe(F.BPE_ASCAIN), ...lieuxDepuisMobilite(F.GARES_ASCAIN), ...lieuxDepuisOverpass(osm), ...lieuxDepuisSirene(F.SIRENE_ASCAIN_DEMO),
  ], etats, { maintenant: QUAND });
}

describe('temps de trajet', () => {
  it('haversine : ~1 km pour 0,009° de latitude', () => {
    const d = distanceM({ lat: 43, lon: -1.6 }, { lat: 43.009, lon: -1.6 });
    assert.ok(d > 990 && d < 1010, String(d));
  });
  it('à pied 4,5 km/h avec détour ; vélo plafonné ; isochrones cohérentes', () => {
    assert.equal(minutesPied(300, true), 5);           // 300 × 1,25 / 75
    assert.equal(minutesPied(10, true), 1);
    assert.equal(minutesVelo(2000, false), 12);        // 2700 / 250 = 10,8 → 11 + 1
    assert.equal(minutesVelo(9000, false), null);
    assert.equal(rayonIsochroneM(5, 'pied', true), 300);
    assert.ok(Math.abs(minutesPied(rayonIsochroneM(10, 'pied', false), false) - 10) <= 1);
    assert.equal(libelleDistance(347), '350 m');
    assert.equal(libelleDistance(5651), '5,7 km');
    const c = cercleGeoJson({ lat: 45, lon: 4 }, 500, 16);
    assert.deepEqual(c[0], c[c.length - 1]);
  });
  it('en transport : seulement loin, arrêt proche, et plus rapide que la marche', () => {
    assert.equal(minutesTransport(800, true, { mode: 'tram', distance_m: 150, nom: 'x' }), null);
    assert.equal(minutesTransport(5000, true, null), null);
    assert.equal(minutesTransport(5000, true, { mode: 'tram', distance_m: 1500, nom: 'x' }), null);
    const t = minutesTransport(5000, true, { mode: 'metro', distance_m: 200, nom: 'x' })!;
    assert.ok(t > 10 && t < minutesPied(5000, true), String(t));
  });
});

describe('classement des sources', () => {
  it('BPE : codes 2021-2024 et anciens ; le nom tranche (D307 pharmacie, EHPAD écarté)', () => {
    assert.equal(classerBpe('B207')?.sousType, 'Boulangerie-pâtisserie');
    assert.equal(classerBpe('B203')?.sousType, 'Boulangerie');
    assert.equal(classerBpe('D307', 'PHARMACIE D\'ASCAIN')?.categorie, 'sante');
    assert.equal(classerBpe('D307', 'EHPAD LES LILAS'), null);
    assert.equal(classerBpe('A101'), null);  // police : pas un argument de vente
    assert.equal(classerBpe('C610'), null);  // organisme de formation
  });
  it('OSM : métro, tram, gare, parc, restaurant, médecin', () => {
    assert.equal(classerOsm({ railway: 'station', station: 'subway' })?.mode, 'metro');
    assert.equal(classerOsm({ railway: 'tram_stop' })?.mode, 'tram');
    assert.equal(classerOsm({ railway: 'station' })?.mode, 'gare');
    assert.equal(classerOsm({ leisure: 'park' })?.categorie, 'loisirs');
    assert.equal(classerOsm({ amenity: 'cafe' })?.categorie, 'restaurants');
    assert.equal(classerOsm({ amenity: 'doctors' })?.categorie, 'sante');
    assert.equal(classerOsm({ amenity: 'parking' }), null);
  });
  it('mobilité : « metro » de mobility_stops affiché prudemment, entrées de station écartées', () => {
    const l = lieuxDepuisMobilite(F.MOBILITE_PARIS);
    assert.ok(l.every((x) => x.mode === 'arret'));
    assert.ok(!l.some((x) => /Lobau/.test(x.nom ?? '')));
    assert.ok(lieuxDepuisMobilite(F.GARES_LYON).every((x) => x.mode === 'gare'));
  });
  it('Overpass : requête bornée, éléments sans nom écartés, centre des polygones lu', () => {
    const q = requeteOverpass(43.3, -1.6, 9000);
    assert.match(q, /around:3000,43\.300000,-1\.600000/);
    assert.match(q, /out center tags/);
    assert.doesNotMatch(requeteOverpass(43.3, -1.6, 900, { transports: false }), /bus_stop/);
    const l = lieuxDepuisOverpass(F.OSM_ASCAIN_DEMO);
    assert.equal(l.length, 5);
    assert.ok(l.some((x) => x.nom === 'Jardin public (démo)' && x.lat === 43.34705));
  });
  it('SIRENE : seuls les établissements d’au moins 50 salariés sont « Emploi »', () => {
    const l = lieuxDepuisSirene(F.SIRENE_ASCAIN_DEMO);
    assert.equal(l.length, 1);
    assert.match(l[0]!.classement.sousType, /^Employeur · Hébergement/);
  });
  it('noms lisibles', () => {
    assert.equal(nomLisible('AU CROISSANT DE LA RHUNE', 'x'), 'Au Croissant de la Rhune');
    assert.equal(nomLisible("PHARMACIE D'ASCAIN", 'x'), "Pharmacie d'Ascain");
    assert.equal(nomLisible('ASCAIN BP', 'x'), 'Ascain BP');
    assert.equal(nomLisible(null, 'Parc'), 'Parc');
    assert.equal(nomLisible('Lyon Part Dieu', 'x'), 'Lyon Part Dieu');
    assert.equal(nomLisible('SEGM BHV', 'x'), 'Segm BHV');
    assert.equal(nomLisible('ECOLE PRIMAIRE PRIVEE STE-MARIE', 'x'), 'École primaire privée Ste-Marie');
  });
});

describe('atouts — Ascain (64065, maison hexagonale)', () => {
  const a = ascain();
  const cat = (id: string) => a.categories.find((c) => c.id === id)!;
  it('7 catégories dans l’ordre, rural', () => {
    assert.deepEqual(a.categories.map((c) => c.id), [...CATEGORIES_QUARTIER]);
    assert.equal(a.urbain, false);
  });
  it('commerces réels triés par distance avec temps à pied et à vélo', () => {
    const c = cat('commerces');
    assert.equal(c.etat, 'ok');
    const d = c.lieux.map((l) => l.distance_m);
    assert.deepEqual(d, [...d].sort((x, y) => x - y));
    assert.equal(c.plusProche!.nom, 'Haute Veronique');
    assert.ok(c.plusProche!.pied_min <= 5);
    assert.ok(c.lieux.every((l) => l.distance_m <= 2000));
  });
  it('écoles et santé : école primaire et pharmacie d’Ascain', () => {
    assert.equal(cat('ecoles').plusProche!.sousType, 'École primaire');
    assert.equal(cat('sante').plusProche!.nom, "Pharmacie d'Ascain");
  });
  it('transports : gare SNCF de Saint-Jean-de-Luz retenue au-delà du rayon (≤ 15 km), arrêt de bus (démo) d’abord', () => {
    const t = cat('transports');
    assert.equal(t.lieux[0]!.nom, 'Ascain Bourg (démo)');
    const gare = t.lieux.find((l) => l.mode === 'gare')!;
    assert.equal(gare.nom, 'Saint-Jean-de-Luz - Ciboure');
    assert.ok(gare.distance_m > 4500 && gare.distance_m < 5500, String(gare.distance_m));
    assert.ok(gare.velo_min !== null && gare.velo_min > 20);
  });
  it('synthèse « À 5 min à pied : … »', () => {
    assert.match(a.synthese.phrase, /^À 5 min à pied : /);
    assert.match(a.synthese.phrase, /une boulangerie/);
    assert.match(a.synthese.phrase, /une école/);
    assert.ok(a.synthese.a5minPied.every((x) => x.minutes <= 5));
  });
  it('emploi : employeur ≥ 50 salariés (démo), sans coordonnées → listé, pas placé', () => {
    const e = cat('emploi');
    assert.equal(e.lieux.length, 1);
    assert.equal(e.lieux[0]!.lat, null);
  });
  it('sources et licences, mention des temps estimés', () => {
    assert.ok(a.sources.some((s) => s.source === 'bpe' && /Etalab/.test(s.licence)));
    assert.ok(a.sources.some((s) => s.source === 'osm' && /ODbL/.test(s.licence)));
    assert.match(a.avertissements[0]!, /estimés/);
  });
  it('source OSM indisponible → « indisponible », jamais « aucun lieu »', () => {
    const b = ascain([{ source: 'bpe', ok: true }, { source: 'mobilite', ok: true }, { source: 'osm', ok: false }, { source: 'sirene', ok: true }], { elements: [] });
    const r = b.categories.find((c) => c.id === 'restaurants')!;
    assert.equal(r.etat, 'indisponible');
    assert.match(r.phrase, /indisponible/);
    assert.ok(b.avertissements.some((x) => /Restaurants et cafés : source momentanément indisponible/.test(x)));
    // Les commerces restent renseignés par la BPE.
    assert.equal(b.categories.find((c) => c.id === 'commerces')!.etat, 'ok');
  });
  it('relu par lireAtouts (stockage, sortie d’outil)', () => {
    assert.ok(lireAtouts(JSON.parse(JSON.stringify(a))));
    assert.equal(lireAtouts({ version: 2 }), null);
  });
});

describe('atouts — ville dense', () => {
  it('Paris (GTFS IDFM réel) : urbain, arrêts dédoublonnés, Hôtel de Ville à 1 min', () => {
    const a = assemblerAtouts(F.PARIS, [...lieuxDepuisBpe(F.BPE_PARIS), ...lieuxDepuisMobilite(F.MOBILITE_PARIS)], TOUS_OK, { maintenant: QUAND });
    assert.equal(a.urbain, true);
    const t = a.categories.find((c) => c.id === 'transports')!;
    assert.equal(t.lieux.filter((l) => l.nom === 'Hôtel de Ville').length, 1);
    assert.equal(t.lieux[0]!.nom, 'Hôtel de Ville');
    assert.equal(t.lieux[0]!.pied_min, 1);
    assert.match(a.synthese.phraseTransports, /Arrêt de transport en commun « Hôtel de Ville » à 1 min à pied/);
    // BHV (5 lignes BPE) dédoublonné.
    assert.equal(a.categories.find((c) => c.id === 'commerces')!.lieux.filter((l) => /BHV/.test(l.nom)).length, 1);
    assert.equal(a.categories.find((c) => c.id === 'restaurants')!.etat, 'vide');
  });
  it('Lyon (gares réelles + OSM démo) : la station de métro OSM au mode précis devant les gares', () => {
    const a = assemblerAtouts(F.LYON, [...lieuxDepuisBpe(F.BPE_LYON), ...lieuxDepuisMobilite(F.GARES_LYON), ...lieuxDepuisOverpass(F.OSM_LYON_DEMO)], TOUS_OK, { maintenant: QUAND });
    assert.equal(a.urbain, true);
    const t = a.categories.find((c) => c.id === 'transports')!;
    assert.equal(t.lieux[0]!.mode, 'metro');
    assert.equal(t.lieux[0]!.nom, 'Bellecour');
    assert.ok(t.lieux.some((l) => l.nom === 'Lyon Perrache' && l.mode === 'gare'));
    // Temps en transport pour un lieu éloigné (Part-Dieu, gare : pas de temps transport sur la catégorie transports elle-même).
    assert.equal(t.lieux.find((l) => l.nom === 'Lyon Part Dieu')!.transport_min, null);
    assert.match(a.synthese.phrase, /^À 5 min à pied : /);
  });
});

describe('textes : chat et dossier client', () => {
  const a = ascain();
  it('lignes de synthèse et bloc « Le quartier » du dossier', () => {
    const l = lignesSynthese(a);
    assert.equal(l.length, 7);
    assert.match(l.find((x) => x.categorie === 'sante')!.valeur, /Pharmacie d'Ascain .* min à pied/);
    const d = texteDossierQuartier(a);
    assert.equal(d.titre, 'Le quartier');
    assert.match(d.accroche, /À 5 min à pied/);
    assert.match(d.sources, /Licence Ouverte Etalab 2\.0/);
    assert.match(d.mention, /non contractuels/);
  });
  it('carte du chat relue depuis la sortie d’outil', () => {
    const tc = { id: 't1', name: OUTIL_QUARTIER_VENTE, status: 'done', output: { status: 'ok', data: { carte: CARTE_QUARTIER, lien_page: '/mimmozia/quartier?conversation=c1', atouts: a } } };
    assert.equal(lireCarteQuartier(tc)?.lienPage, '/mimmozia/quartier?conversation=c1');
    assert.equal(lireCarteQuartier({ ...tc, status: 'running' }), null);
    assert.equal(lireCarteQuartier({ ...tc, name: 'autre' }), null);
  });
});

describe('menu de navigation du bureau de vente', () => {
  const travaux = [
    { id: 'j1', type: 'image', statut: 'termine', cree_le: '2026-11-20T10:00:00Z', termine_le: '2026-11-20T11:00:00Z',
      resultat: { images: [
        { vue: 'aerien', libelle: 'Vue aérienne', jpeg_path: 'u/j1/aerien.jpg', famille: 'exterieur' },
        { vue: 'trois_quarts_gauche', libelle: 'Trois-quarts gauche', jpeg_path: 'u/j1/tq.jpg', famille: 'exterieur' },
        { vue: 'sejour', libelle: 'Séjour', jpeg_path: 'u/j1/sejour.jpg', famille: 'interieur' },
      ] } },
    { id: 'j2', type: 'visite360', statut: 'termine', cree_le: '2026-11-21T10:00:00Z', resultat: { visite_id: 'v-42' } },
  ];
  it('six entrées, vue aérienne trouvée, visite /visite/<id>, plans « À venir »', () => {
    const m = construireMenuVente(collecterLivrables(travaux), { conversationId: 'c1', origine: 'https://mimmoza.fr/' });
    assert.deepEqual(m.entrees.map((e) => e.libelle), ['Plan masse', 'Situation', 'Extérieur', 'Plans', 'Intérieur', 'Galerie']);
    assert.equal(m.vueAerienne?.chemin, 'u/j1/aerien.jpg');
    const int = m.entrees.find((e) => e.vue === 'interieur')!;
    assert.equal(int.lien, 'https://mimmoza.fr/visite/v-42');
    assert.equal(m.entrees.find((e) => e.vue === 'plans')!.disponible, false);
    assert.equal(m.grilleVente.lien, '/mimmozia/vente?conversation=c1');
  });
  it('sans livrable : rien de simulé', () => {
    const m = construireMenuVente(null);
    assert.equal(m.entrees.filter((e) => e.disponible).length, 2);
    assert.equal(m.vueAerienne, null);
  });
  it('adresses', () => {
    assert.equal(adressePageQuartier({ conversationId: 'c 1', lat: 43.3, lon: -1.6, vue: 'plan-masse' }), '/mimmozia/quartier?conversation=c+1&lat=43.300000&lon=-1.600000&vue=plan-masse');
    assert.equal(lienGrilleVente(null), '/mimmozia/vente');
    assert.equal(vueDepuisAdresse('galerie'), 'galerie');
    assert.equal(vueDepuisAdresse('xx'), 'situation');
  });
});

describe('projet depuis la parcelle (studio_preparations)', () => {
  it('Ascain 64065000AI0002 : centroïde dans la parcelle, INSEE 64065', async () => {
    const { projetDepuisPreparation } = await import('./atoutsQuartier.ts');
    const p = projetDepuisPreparation({ parcelle: { idu: '64065000AI0002', geometrie: { type: 'MultiPolygon', coordinates: [[F.ASCAIN.contour]] } } })!;
    assert.equal(p.communeInsee, '64065');
    assert.ok(Math.abs(p.lat - 43.348) < 0.001 && Math.abs(p.lon + 1.621) < 0.001, `${p.lat},${p.lon}`);
    assert.equal(projetDepuisPreparation({ parcelle: {} }), null);
  });
});
