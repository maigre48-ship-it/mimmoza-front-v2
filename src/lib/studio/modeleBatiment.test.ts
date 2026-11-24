// npx tsx --test src/lib/studio/modeleBatiment.test.ts
// VIS-25 lot A — contrat « modèle du bâtiment » (ModeleBatiment v1) : forme du contrat, validation sans confiance
// (bornes, rien qui flotte, ouvertures dans leur façade, chevauchements), retouches par différences, compatibilité
// VIS-22, quatre exemples réels.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appliquerRetouche, appliquerRetouches, blocModele, BORNES_MODELE, contourVolume, depuisDescriptionBatiment, empreinteModele,
  facadesVolume, hauteurToit, MODELE_BLOC_LANGUE, MODELE_VERSION, modeleDuMessage, ouverturesPosees, REF_FACADE_DESCRIPTION,
  resoudreFacade, resumerModele, sansBlocModele, sommetVolume, validerModele, versDescriptionBatiment,
  type ModeleBatiment,
} from './modeleBatiment.ts';
import { EXEMPLE_COLLECTIF_U, EXEMPLE_MAISON_BASQUE, EXEMPLE_MAISON_TOURELLE, EXEMPLE_VILLA_L, EXEMPLES_MODELE } from './modeleBatimentExemples.ts';
import { validerDescription } from './descriptionBatiment.ts';
import { CATALOGUE_EXTERIEUR } from '../../spaces/copilot/studio3d/catalogueExterieur.ts';

const REFS = CATALOGUE_EXTERIEUR.map((e) => e.refStudio).filter((r): r is string => !!r);

function valide(brut: unknown): { modele: ModeleBatiment; corrections: string[]; avertissements: string[] } {
  const v = validerModele(brut, { refsConnues: REFS });
  if (!v.ok) assert.fail(v.erreur);
  return v;
}
const copie = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const maisonSimple = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  volumes: [{ id: 'm', plan: { type: 'rectangle', largeur: 10, profondeur: 8 }, niveaux: 2 }], ...extra,
});

// ---- Contrat -------------------------------------------------------------------

test('contrat : version, bloc, valeurs par défaut lisibles', () => {
  assert.equal(MODELE_VERSION, 1);
  assert.equal(MODELE_BLOC_LANGUE, 'mimmoza-modele');
  const { modele, corrections } = valide(maisonSimple());
  assert.deepEqual(corrections, []);
  assert.equal(modele.v, 1);
  const v = modele.volumes[0]!;
  assert.equal(v.role, 'principal');
  assert.equal(v.hauteurEtage, 2.8);
  assert.equal(v.hauteur, 5.6);
  assert.equal(v.toit.forme, 'deux_pans');
  assert.equal(v.altitudeBase, 0);
});

test('contrat : les quatre exemples sont valides SANS correction, et la validation est idempotente', () => {
  for (const [nom, ex] of Object.entries(EXEMPLES_MODELE)) {
    const a = valide(ex);
    assert.deepEqual(a.corrections, [], `${nom} : ${a.corrections.join(' | ')}`);
    assert.deepEqual(a.avertissements, [], `${nom} : ${a.avertissements.join(' | ')}`);
    const b = valide(copie(a.modele));
    assert.deepEqual(b.corrections, [], nom);
    assert.equal(empreinteModele(b.modele), empreinteModele(a.modele), nom);
    assert.deepEqual(b.modele, a.modele, nom);
  }
});

test('contrat : les références de matière de la compatibilité VIS-22 existent dans le catalogue extérieur VIS-24', () => {
  for (const x of Object.values(REF_FACADE_DESCRIPTION)) for (const r of [x.refStudio, x.claire, x.foncee]) if (r) assert.ok(REFS.includes(r), r);
  for (const ex of Object.values(EXEMPLES_MODELE)) for (const m of JSON.stringify(ex).matchAll(/"refStudio":"([^"]+)"/g)) assert.ok(REFS.includes(m[1]!), m[1]);
});

test('contrat : façades d\'un rectangle (gauche → droite vu de l\'extérieur) et d\'un volume tourné', () => {
  const v = { plan: { type: 'rectangle' as const, largeur: 10, profondeur: 6 }, position: { x: 100, y: 50 }, rotation: 0 };
  const av = resoudreFacade(v, 'avant')!;
  assert.deepEqual([av.gauche, av.droite], [[95, 47], [105, 47]]);
  assert.deepEqual(av.normale.map((x) => Math.round(x) + 0), [0, -1]);
  assert.equal(resoudreFacade(v, 'droite')!.longueur, 6);
  // Tourné de 90° : la façade « avant » du volume regarde +x.
  const t = resoudreFacade({ ...v, rotation: 90 }, 'avant')!;
  assert.deepEqual(t.normale.map((x) => Math.round(x) + 0), [1, 0]);
  assert.equal(facadesVolume(v).length, 4);
});

test('contrat : L, polygone remis dans le bon sens, cercle et arc', () => {
  const { modele } = valide({
    volumes: [
      { id: 'l', plan: { type: 'L', largeur: 18, profondeur: 14, epaisseurX: 7, epaisseurY: 7, coinVide: 'avant_gauche' } },
      { id: 'p', plan: { type: 'polygone', points: [[0, 0], [0, 6], [8, 6], [8, 0]] }, position: { x: 40, y: 0 } },
      { id: 'c', plan: { type: 'cercle', rayon: 3 }, position: { x: -40, y: 0 } },
      { id: 'a', plan: { type: 'arc', rayonExterieur: 10, rayonInterieur: 4, angleDebut: 0, angleFin: 90 }, position: { x: 0, y: 60 } },
    ],
  });
  const [l, p, c, a] = modele.volumes;
  assert.equal(contourVolume(l!).length, 6);
  const pts = (p!.plan as unknown as { points: [number, number][] }).points;
  assert.deepEqual(pts[0], [0, 0]); // départ avant gauche
  assert.deepEqual(pts[1], [8, 0]); // sens trigonométrique
  assert.equal(contourVolume(c!).length, 12);
  assert.ok(Math.abs(resoudreFacade(c!, 'avant')!.normale[1] + 1) < 1e-9, 'côté avant du cercle centré sur l\'avant');
  assert.ok(contourVolume(a!).length >= 8);
});

// ---- Validation sans confiance -------------------------------------------------

test('validation : jamais d\'exception, refus clairs quand rien n\'est lisible', () => {
  for (const brut of [null, 42, 'maison', [], {}, { volumes: 'beaucoup' }, { volumes: [null, 3, { plan: 'carré' }] }, { v: 2, volumes: [] }]) {
    const v = validerModele(brut);
    assert.equal(v.ok, false, JSON.stringify(brut));
    if (!v.ok) assert.ok(v.erreur.length > 5);
  }
  // Objet cyclique : pas d'exception.
  const cyclique: Record<string, unknown> = { volumes: [{ plan: { type: 'rectangle', largeur: 5, profondeur: 5 } }] };
  cyclique.moi = cyclique;
  assert.equal(validerModele(cyclique).ok, true);
});

test('validation : bornes ramenées et DITES en français', () => {
  const { modele, corrections } = valide({
    volumes: [{ id: 'm', plan: { type: 'rectangle', largeur: 900, profondeur: -3 }, niveaux: 80, hauteurEtage: 12, toit: { forme: 'deux_pans', pente: 89, debord: 7 } }],
  });
  const v = modele.volumes[0]!;
  assert.equal(v.plan.type === 'rectangle' && v.plan.largeur, BORNES_MODELE.dimMax);
  assert.equal(v.plan.type === 'rectangle' && v.plan.profondeur, BORNES_MODELE.dimMin);
  assert.equal(v.niveaux, 30);
  assert.equal(v.hauteurEtage, 6);
  assert.equal(v.toit.pente, 75);
  assert.equal(v.toit.debord, 2);
  assert.ok(corrections.some((c) => c.includes('niveaux ramené')), corrections.join(' | '));
  assert.ok(corrections.every((c) => /^[^{}<>]+$/.test(c)));
});

test('validation : hauteur seule → niveaux et hauteur d\'étage déduits', () => {
  const { modele, corrections } = valide({ volumes: [{ plan: { type: 'rectangle', largeur: 6, profondeur: 6 }, hauteur: 3 }] });
  assert.deepEqual(corrections, []);
  assert.equal(modele.volumes[0]!.niveaux, 1);
  assert.equal(modele.volumes[0]!.hauteurEtage, 3);
});

test('validation : rien ne flotte — volume en l\'air posé au sol, volume au-dessus posé sur son appui', () => {
  const { modele, corrections } = valide({
    volumes: [
      { id: 'socle', plan: { type: 'rectangle', largeur: 12, profondeur: 10 }, niveaux: 2, hauteurEtage: 3, toit: { forme: 'terrasse' } },
      { id: 'attique', role: 'attique', plan: { type: 'rectangle', largeur: 8, profondeur: 6 }, altitudeBase: 6.2, toit: { forme: 'terrasse' } },
      { id: 'nuage', plan: { type: 'rectangle', largeur: 4, profondeur: 4 }, position: { x: 50, y: 0 }, altitudeBase: 10 },
      { id: 'trop-haut', plan: { type: 'rectangle', largeur: 4, profondeur: 4 }, altitudeBase: 14 },
    ],
  });
  const par = (id: string) => modele.volumes.find((v) => v.id === id)!;
  assert.equal(par('attique').altitudeBase, 6, 'recalé sur le haut des murs du socle');
  assert.equal(par('nuage').altitudeBase, 0);
  assert.ok(corrections.some((c) => c.includes('flottait : posé au sol')));
  assert.ok(par('trop-haut').altitudeBase <= 9, 'descendu sur un appui');
  assert.ok(corrections.some((c) => c.includes('flottait : posé sur')));
});

test('validation : briques qui flottent posées au sol ; briques qui s\'appuient de proche en proche gardées', () => {
  const { modele, corrections } = valide(maisonSimple({
    elements: [
      { id: 'kiosque', type: 'kiosque_a_musique', briques: [
        { forme: 'poteau', x: 30, y: 30, z: 0, largeur: 0.2, hauteur: 3 },
        { forme: 'plaque', x: 30, y: 30, z: 3, largeur: 4, profondeur: 4, hauteur: 0.2 },
        { forme: 'cone', x: 30, y: 30, z: 3.2, largeur: 4, hauteur: 2 },
      ] },
      { id: 'ovni', type: 'autre', nom: 'soucoupe', briques: [{ forme: 'cylindre', x: -40, y: -40, z: 12, largeur: 3, hauteur: 0.5 }] },
      { id: 'marquise', type: 'autre', nom: 'marquise', briques: [{ forme: 'plaque', x: 0, y: -4.6, z: 2.5, largeur: 2, profondeur: 1.2, hauteur: 0.1 }] },
    ],
  }));
  const k = modele.elements.find((e) => e.id === 'kiosque')!;
  assert.equal(k.type, 'autre', 'type inconnu → « autre », jamais refusé');
  assert.equal(k.nom, 'kiosque a musique');
  assert.deepEqual(k.briques.map((b) => b.z), [0, 3, 3.2]);
  assert.equal(modele.elements.find((e) => e.id === 'ovni')!.briques[0]!.z, 0);
  assert.ok(corrections.some((c) => c.includes('soucoupe') && c.includes('flottaient')));
  assert.equal(modele.elements.find((e) => e.id === 'marquise')!.briques[0]!.z, 2.5, 'accrochée à la façade');
});

test('validation : ouvertures tenues dans leur façade, leur étage, et sans chevauchement', () => {
  const { modele, corrections } = valide(maisonSimple({
    ouvertures: [
      { id: 'large', volume: 'm', facade: 'droite', type: 'baie', largeur: 20 },
      { id: 'dehors', volume: 'm', facade: 'avant', type: 'fenetre', position: 50 },
      { id: 'haute', volume: 'm', facade: 'arriere', niveau: 1, type: 'fenetre', hauteur: 3, allege: 1 },
      { id: 'garage-etage', volume: 'm', facade: 'gauche', niveau: 1, type: 'porte_garage' },
      { id: 'a', volume: 'm', facade: 'avant', niveau: 1, type: 'fenetre', position: 3 },
      { id: 'b', volume: 'm', facade: 'avant', niveau: 1, type: 'fenetre', position: 3.4 },
      { id: 'trop', volume: 'm', facade: 'arriere', niveau: 0, type: 'fenetre', nombre: 30 },
      { id: 'perdue', volume: 'inconnu', facade: 'nord', type: 'fenetre', niveau: 9 },
    ],
  }));
  const o = (id: string) => modele.ouvertures.find((x) => x.id === id);
  assert.equal(o('large')!.largeur, 7.7);
  assert.equal(o('dehors')!.position, 10 - 0.15 - 0.5);
  assert.ok(o('haute')!.allege + o('haute')!.hauteur <= 2.65 + 1e-9);
  assert.equal(o('garage-etage')!.niveau, 0);
  assert.equal(o('b'), undefined, 'chevauchait a : retirée');
  assert.ok(corrections.some((c) => c.includes('« b » chevauchait « a »')));
  assert.ok(o('trop')!.nombre < 30);
  assert.equal(o('perdue')!.volume, 'm');
  assert.equal(o('perdue')!.facade, 'avant');
  assert.equal(o('perdue')!.niveau, 1);
  for (const p of ouverturesPosees(modele)) {
    assert.ok(p.centre - p.largeur / 2 >= 0.149 && p.centre + p.largeur / 2 <= p.facade.longueur - 0.149, `${p.id} dans sa façade`);
  }
});

test('validation : lucarne sur un pignon déplacée sur un pan ; lucarne sur toit plat devient fenêtre', () => {
  const basque = valide(EXEMPLE_MAISON_BASQUE).modele; // faîtage perpendiculaire à la rue : pignon sur rue
  const r = appliquerRetouche(basque, { action: 'ajouter', quoi: 'ouverture', objet: { volume: 'principal', facade: 'avant', type: 'lucarne' } });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const l = r.modele.ouvertures.find((o) => o.type === 'lucarne')!;
  assert.equal(l.facade, 'gauche');
  assert.ok(r.corrections.some((c) => c.includes('pignon')));
  const plat = valide(maisonSimple({ volumes: [{ id: 'm', plan: { type: 'rectangle', largeur: 10, profondeur: 8 }, toit: { forme: 'terrasse' } }], ouvertures: [{ volume: 'm', type: 'lucarne' }] }));
  assert.equal(plat.modele.ouvertures[0]!.type, 'fenetre');
});

test('validation : chevauchements absurdes signalés (pas corrigés), doublons retirés', () => {
  const { modele, avertissements, corrections } = valide({
    volumes: [
      { id: 'grand', plan: { type: 'rectangle', largeur: 20, profondeur: 20 }, niveaux: 3 },
      { id: 'cache', plan: { type: 'rectangle', largeur: 4, profondeur: 4 }, niveaux: 1 },
      { id: 'jumeau', plan: { type: 'rectangle', largeur: 20, profondeur: 20 }, niveaux: 3 },
    ],
  });
  assert.ok(avertissements.some((a) => a.includes('« cache »') && a.includes('caché')), avertissements.join(' | '));
  assert.equal(modele.volumes.length, 2);
  assert.ok(corrections.some((c) => c.includes('identique')));
});

test('validation : identifiants en double renommés, matières lues sans confiance', () => {
  const { modele, corrections } = valide(maisonSimple({
    matieres: { murs: { refStudio: 'av-inexistant', couleur: '#ABCDEF', famille: 'enduit' }, toiture: '#123456', inconnue: { couleur: '#000000' } },
    ouvertures: [{ id: 'x', volume: 'm', type: 'fenetre', position: 2 }, { id: 'x', volume: 'm', type: 'fenetre', position: 8 }],
  }));
  assert.deepEqual(modele.ouvertures.map((o) => o.id), ['x', 'o1']);
  assert.deepEqual(modele.matieres.murs, { refStudio: null, couleur: '#abcdef', famille: 'enduit' });
  assert.equal(modele.matieres.toiture?.couleur, '#123456');
  assert.ok(corrections.some((c) => c.includes('av-inexistant')));
  assert.ok(corrections.some((c) => c.includes('partie « inconnue »')));
});

test('validation : bornes de nombre d\'objets', () => {
  const vols = Array.from({ length: 40 }, (_, i) => ({ plan: { type: 'rectangle', largeur: 3, profondeur: 3 }, position: { x: i * 5, y: 0 } }));
  const { modele, corrections } = valide({ volumes: vols });
  assert.equal(modele.volumes.length, BORNES_MODELE.volumesMax);
  assert.ok(corrections.some((c) => c.includes('24 volumes au plus')));
});

test('validation : mode strict (bloc relu d\'un message) — la moindre correction est un refus', () => {
  const ok = valide(EXEMPLE_VILLA_L).modele;
  const texte = `Voici.\n\n${blocModele(ok)}`;
  const relu = modeleDuMessage(texte);
  assert.equal(relu?.ok, true);
  assert.equal(sansBlocModele(texte).visible, 'Voici.');
  const abime = copie(ok) as unknown as { volumes: { niveaux: number }[] };
  abime.volumes[0]!.niveaux = 99;
  const refuse = modeleDuMessage(blocModele(abime as unknown as ModeleBatiment));
  assert.equal(refuse?.ok, false);
  assert.equal(modeleDuMessage('pas de bloc'), null);
  assert.equal(modeleDuMessage('```mimmoza-modele\n{pas du json\n```')?.ok, false);
});

// ---- Résumé, empreinte ------------------------------------------------------------

test('résumé lisible et empreinte stable', () => {
  const m = valide(EXEMPLE_MAISON_BASQUE).modele;
  const r = resumerModele(m);
  assert.match(r, /^Maison basque : 2 volumes/);
  assert.match(r, /toit à deux pans 30°/);
  assert.match(r, /1 porte de garage/);
  assert.match(empreinteModele(m), /^mb1-[0-9a-f]{8}$/);
  const autre = copie(m); autre.volumes[0]!.toit.pente = 31;
  assert.notEqual(empreinteModele(autre), empreinteModele(m));
  // L'ordre des clés ne change pas l'empreinte.
  const melange = JSON.parse(JSON.stringify(m, Object.keys(m).reverse())) as ModeleBatiment;
  assert.equal(empreinteModele({ ...melange, ...m }), empreinteModele(m));
});

// ---- Retouches ----------------------------------------------------------------

test('retouches : ajouter une lucarne, décaler le garage, retirer, modifier', () => {
  const m = valide(EXEMPLE_MAISON_TOURELLE).modele;
  const a = appliquerRetouche(m, { action: 'ajouter', quoi: 'ouverture', objet: { volume: 'maison', facade: 'arriere', type: 'lucarne' } });
  assert.equal(a.ok, true);
  if (!a.ok) return;
  assert.equal(a.modele.ouvertures.filter((o) => o.type === 'lucarne').length, 2, 'un groupe de 2 + 1 nouvelle');
  assert.equal(a.modele.ouvertures.length, m.ouvertures.length + 1);
  assert.match(a.fait[0]!, /ajouté : lucarne/);

  const basque = valide(EXEMPLE_MAISON_BASQUE).modele;
  const d = appliquerRetouche(basque, { action: 'deplacer', id: 'garage', dx: -1.5 });
  assert.equal(d.ok, true);
  if (!d.ok) return;
  assert.deepEqual(d.modele.volumes.find((v) => v.id === 'garage')!.position, { x: -10.5, y: -1.5 });
  assert.equal(d.modele.ouvertures.find((o) => o.id === 'garage-porte')!.volume, 'garage', 'la porte suit le garage');

  const g = appliquerRetouche(basque, { action: 'deplacer', id: 'porte', decalage: 2 });
  assert.equal(g.ok && g.modele.ouvertures.find((o) => o.id === 'porte')!.position, 8);

  const r = appliquerRetouche(basque, { action: 'retirer', id: 'garage' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.modele.volumes.length, 1);
  assert.equal(r.modele.ouvertures.some((o) => o.volume === 'garage'), false);

  const n = appliquerRetouche(basque, { action: 'modifier', id: 'principal', champs: { niveaux: 3 } });
  assert.equal(n.ok, true);
  if (!n.ok) return;
  const p = n.modele.volumes.find((v) => v.id === 'principal')!;
  assert.equal(p.niveaux, 3);
  assert.equal(p.hauteur, 8.1);

  const t = appliquerRetouche(basque, { action: 'modifier', id: 'principal', champs: { toit: { forme: 'quatre_pans' } } });
  assert.equal(t.ok && t.modele.volumes[0]!.toit.pente, 30, 'pente par défaut de la nouvelle forme');

  const s = appliquerRetouche(basque, { action: 'modifier_modele', champs: { matieres: { murs: { refStudio: 'av-brique-rouge', famille: 'brique' } } } });
  assert.equal(s.ok && s.modele.matieres.murs?.refStudio, 'av-brique-rouge');
  assert.equal(s.ok && s.modele.matieres.toiture?.famille, 'tuile', 'les autres matières restent');
});

test('retouches : refus propres (id inconnu, dernier volume, action inconnue) — modèle rendu intact', () => {
  const m = valide(EXEMPLE_VILLA_L).modele;
  for (const r of [{ action: 'retirer', id: 'nulle-part' }, { action: 'retirer', id: 'villa' }, { action: 'repeindre' }, null, { action: 'ajouter', quoi: 'jardin', objet: {} }]) {
    const x = appliquerRetouche(m, r);
    assert.equal(x.ok, false, JSON.stringify(r));
    assert.equal(x.modele, m);
  }
  const plusieurs = appliquerRetouches(m, [
    { action: 'ajouter', quoi: 'element', objet: { type: 'cheminee', volume: 'villa', point: { x: -6, y: 4, z: 0 } } },
    { action: 'deplacer', id: 'pergola', dx: 1 },
  ]);
  assert.equal(plusieurs.ok, true);
  if (!plusieurs.ok) return;
  assert.equal(plusieurs.modele.elements.find((e) => e.id === 'pergola')!.briques[0]!.x, 1.2);
});

// ---- Compatibilité VIS-22 -----------------------------------------------------

test('compatibilité : modèle → description VIS-22 valide (basque, L, tourelle, U)', () => {
  const basque = versDescriptionBatiment(valide(EXEMPLE_MAISON_BASQUE).modele);
  assert.equal(validerDescription(basque, true).ok, true);
  assert.equal(basque.style, 'basque');
  assert.equal(basque.toiture.forme, 'deux_pans');
  assert.equal(basque.niveaux, 2);
  assert.equal(basque.ouvertures.volets, 'battants');
  assert.equal(basque.ouvertures.couleurVolets, 'rouge');
  assert.ok(basque.elements.some((e) => e.type === 'garage_accole' && e.cote === 'gauche'));
  assert.ok(basque.elements.some((e) => e.type === 'colombages' && e.couleur === 'rouge'));
  const villa = versDescriptionBatiment(valide(EXEMPLE_VILLA_L).modele);
  assert.equal(villa.forme, 'l');
  assert.equal(villa.toiture.forme, 'terrasse');
  assert.equal(villa.ouvertures.type, 'baies_vitrees');
  assert.ok(villa.elements.some((e) => e.type === 'pergola'));
  const tour = versDescriptionBatiment(valide(EXEMPLE_MAISON_TOURELLE).modele);
  assert.equal(tour.toiture.couverture, 'ardoise');
  assert.equal(tour.facade.materiau, 'pierre');
  assert.ok(tour.elements.some((e) => e.type === 'tourelle'));
  assert.ok(tour.elements.some((e) => e.type === 'lucarnes'));
  const u = versDescriptionBatiment(valide(EXEMPLE_COLLECTIF_U).modele);
  assert.equal(u.forme, 'u');
  assert.equal(u.type, 'collectif');
  assert.equal(u.niveaux, 3);
});

test('compatibilité : description VIS-22 → modèle composé (le passé continue de marcher)', () => {
  const d = validerDescription({
    origine: 'texte', type: 'maison', niveaux: 2, style: 'basque',
    toiture: { forme: 'deux_pans', couverture: 'tuiles' }, facade: { materiau: 'enduit_blanc' },
    ouvertures: { type: 'fenetres_verticales', volets: 'battants', couleurVolets: 'rouge' },
    balcons: { type: 'balcons_filants', gardeCorps: 'plein' },
    elements: [{ type: 'colombages', couleur: 'rouge' }, { type: 'garage_accole', cote: 'gauche' }, { type: 'lucarnes' }, { type: 'cheminee' }],
  });
  assert.equal(d.ok, true);
  if (!d.ok) return;
  const m = depuisDescriptionBatiment(d.valeur);
  assert.equal(m.origine, 'description');
  assert.equal(m.style, 'basque');
  assert.equal(m.volumes.length, 2);
  const garage = m.volumes.find((v) => v.role === 'garage')!;
  const principal = m.volumes.find((v) => v.role === 'principal')!;
  assert.ok(garage.position.x < principal.position.x, 'garage à gauche');
  assert.equal(principal.niveaux, 2);
  assert.ok(m.ouvertures.some((o) => o.type === 'porte_garage'));
  assert.ok(m.ouvertures.some((o) => o.type === 'lucarne'));
  assert.ok(m.elements.some((e) => e.type === 'balcon'));
  assert.equal(m.matieres.murs?.refStudio, 'av-enduit-blanc');
  assert.equal(validerModele(m).ok && validerModele(m).corrections.length, 0, 'le modèle produit est propre');
  // Aller-retour : on retrouve l'essentiel.
  const retour = versDescriptionBatiment(m);
  assert.equal(retour.style, 'basque');
  assert.equal(retour.niveaux, 2);
  assert.equal(retour.toiture.forme, 'deux_pans');
  assert.equal(retour.balcons.type, 'balcons_filants');
  assert.ok(retour.elements.some((e) => e.type === 'garage_accole' && e.cote === 'gauche'));
  // Toutes les formes VIS-22 donnent un modèle valide.
  for (const forme of ['plot', 'barre', 'l', 'u', 'cour', 'redans', null]) for (const toit of ['terrasse', 'quatre_pans', 'monopente', 'mansarde', 'vegetalisee']) {
    const dd = validerDescription({ origine: 'texte', type: 'collectif', forme, niveaux: 4, toiture: { forme: toit }, attique: toit === 'terrasse', balcons: { type: 'loggias' } });
    assert.equal(dd.ok, true);
    if (!dd.ok) continue;
    const mm = depuisDescriptionBatiment(dd.valeur);
    assert.ok(mm.volumes.length >= 1, `${forme} ${toit}`);
  }
});

// ---- Exemples réels : géométrie ----------------------------------------------------

test('exemples : géométrie attendue (hauteurs, toits, ouvertures posées)', () => {
  const basque = valide(EXEMPLE_MAISON_BASQUE).modele;
  assert.equal(basque.volumes.length, 2);
  assert.equal(sommetVolume(basque.volumes[0]!), 8.86); // 5,4 m de murs + 5 m × tan 30°
  assert.equal(ouverturesPosees(basque).length, 14);
  const villa = valide(EXEMPLE_VILLA_L).modele;
  assert.equal(hauteurToit(villa.volumes[0]!), 0.4);
  assert.equal(resoudreFacade(villa.volumes[0]!, 'arriere')!.longueur, 11, 'façade sur jardin, au creux du L');
  const tour = valide(EXEMPLE_MAISON_TOURELLE).modele;
  const t = tour.volumes.find((v) => v.id === 'tourelle')!;
  assert.equal(t.hauteur, 7.8);
  assert.equal(t.niveaux, 3);
  assert.ok(sommetVolume(t) > sommetVolume(tour.volumes[0]!), 'la tourelle dépasse la maison');
  const u = valide(EXEMPLE_COLLECTIF_U).modele;
  assert.equal(ouverturesPosees(u).length, 33);
  assert.equal(resoudreFacade(u.volumes[0]!, 4)!.cote, 'arriere');
});
