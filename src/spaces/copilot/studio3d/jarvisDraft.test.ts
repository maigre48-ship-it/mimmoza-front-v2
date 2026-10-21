import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { draftBrief, facadeRules, is3DPreparationRequest, jarvisAppearance, jarvisMassing, latestJarvisDraft, parseJarvisDraft, readJarvisDraft, reconcileJarvisDraft, studioCommand, studioComposition, studioSegmentedVolume, withoutJarvisDraft } from './jarvisDraft.ts';
import { levelFootprint, previewRoof } from './massingGeometry.ts';

const noVolumeStyle = { shape: null, architecturalStyle: null, articulation: null };

const block = [
  '```mimmoza-3d',
  '{"version":1,"objectif":"Prévisualiser l\'immeuble","localisation":null,"programme":"12 logements","dimensions":null,"style":null,"contraintes":null,"questions":["Quelle adresse ?"],"pieces":["plan.pdf"]}',
  '```',
].join('\n');

describe('dossier 3D de Jarvis', () => {
  it('lit la dernière fiche complète et garde les inconnues vides', () => {
    const draft = readJarvisDraft(`Je peux préparer ce projet.\n${block}`);
    assert.equal(draft?.programme, '12 logements');
    assert.equal(draft?.localisation, null);
    assert.deepEqual(draft?.pieces, ['plan.pdf']);
    assert.equal(latestJarvisDraft([
      { role: 'assistant', text: block },
      { role: 'user', text: 'À Lyon' },
      { role: 'assistant', text: `Nouveau dossier\n${block.replace('null,"programme"', '"Lyon","programme"')}` },
    ])?.localisation, 'Lyon');
  });

  it('masque le bloc et ignore un bloc incomplet pendant le flux', () => {
    assert.equal(withoutJarvisDraft(`Réponse claire\n${block}`), 'Réponse claire');
    assert.equal(withoutJarvisDraft('Réponse claire\n```mimmoza-3d\n{"version":1'), 'Réponse claire');
    assert.equal(readJarvisDraft('```mimmoza-3d\n{"version":1'), null);
  });

  it('distingue une demande de projet d’une question explicative', () => {
    assert.equal(is3DPreparationRequest('Prépare une maquette 3D de cet immeuble'), true);
    assert.equal(is3DPreparationRequest('Comment fonctionne la 3D ?'), false);
    assert.equal(latestJarvisDraft([{ role: 'user', text: 'Prépare une maquette 3D' }])?.programme, null);
  });

  it('reprend les paramètres explicites quand le copilote ne fournit pas de fiche', () => {
    const draft = latestJarvisDraft([
      { role: 'user', text: 'Prépare une maquette 3D d’un immeuble collectif R+5 de 30 m sur 14 m, avec 12 logements.' },
      { role: 'assistant', text: 'Ouvrir Massing 3D' },
    ]);
    assert.equal(draft?.programme, '12 logements');
    assert.equal(draft?.dimensions, '30 m sur 14 m');
    assert.equal(draft?.localisation, null);
    assert.deepEqual(draft?.questions, []);
    assert.equal(studioCommand(draft!), 'Crée un immeuble collectif R+5 de 30 m sur 14 m.');
  });

  it('conserve dimensions et logements explicites si la réponse structurée les omet', () => {
    const incomplete = block.replace('"programme":"12 logements"', '"programme":null');
    const draft = latestJarvisDraft([
      { role: 'user', text: 'Prépare une maquette 3D d’un immeuble collectif R+5 de 30 m sur 14 m, avec 12 logements.' },
      { role: 'assistant', text: incomplete },
    ]);
    assert.equal(draft?.programme, '12 logements');
    assert.equal(draft?.dimensions, '30 m sur 14 m');
    assert.equal(studioCommand(draft!), 'Crée un immeuble collectif R+5 de 30 m sur 14 m.');
  });

  it('nettoie une fiche corrigée avant enregistrement', () => {
    const draft = parseJarvisDraft({
      version: 1, objectif: '  Rénover une maison  ', localisation: '',
      programme: null, dimensions: null, style: null, contraintes: null,
      questions: ['  Quelle surface ? ', 12], pieces: ['plan.pdf'],
    });
    assert.equal(draft?.objectif, 'Rénover une maison');
    assert.equal(draft?.localisation, null);
    assert.deepEqual(draft?.questions, ['Quelle surface ?']);
  });

  it('prépare un brief Studio borné et sans valeurs inventées', () => {
    const draft = parseJarvisDraft({
      version: 1, objectif: 'Créer un immeuble', localisation: null,
      programme: 'Logements '.repeat(400), dimensions: null, style: null,
      contraintes: null, questions: ['Quelle adresse ?'], pieces: [],
    });
    assert.ok(draft);
    const brief = draftBrief(draft);
    assert.match(brief, /^Dossier 3D confirmé avec Mimmo\./);
    assert.ok(brief.includes('objectif : Créer un immeuble'));
    assert.ok(!brief.includes('localisation :'));
    assert.ok(brief.length <= 2000);
  });

  it('sépare la commande de création du programme et du brief', () => {
    const draft = parseJarvisDraft({
      version: 1, objectif: 'Prévisualiser un immeuble collectif R+5',
      localisation: 'Lyon', programme: '12 logements', dimensions: '30 m sur 14 m',
      style: null, contraintes: null, questions: [], pieces: [],
    });
    assert.ok(draft);
    assert.equal(studioCommand(draft), 'Crée un immeuble collectif R+5 de 30 m sur 14 m.');
    assert.match(draftBrief(draft), /programme : 12 logements/);
    assert.equal(studioCommand({ ...draft, objectif: 'Prévisualiser une idée', programme: null }), null);
    assert.equal(studioCommand({
      ...draft,
      objectif: "Je souhaite une prévisualisation 3D d'un immeuble collectif R+5 avec visite et rendu",
      programme: '12 logements avec une toiture en zinc',
    }), 'Crée un immeuble collectif R+5 de 30 m sur 14 m.');
    assert.equal(studioCommand({ ...draft, objectif: 'Créer une maison R+1', programme: null, dimensions: 'environ 120 m²' }), 'Crée une maison R+1.');
  });

  it('construit une esquisse seulement avec dimensions et niveaux explicites', () => {
    const dossier = parseJarvisDraft({ version: 1, objectif: 'Immeuble collectif R+5', localisation: null,
      programme: '12 logements', dimensions: '30 m sur 14 m', style: null, contraintes: null, questions: [], pieces: [] });
    assert.ok(dossier);
    assert.deepEqual(jarvisMassing(dossier), { largeurM: 30, profondeurM: 14, niveaux: 6, logements: 12, appearance: { facade: null, roof: null, openings: null, ...noVolumeStyle } });
    assert.equal(jarvisMassing({ ...dossier, dimensions: null }), null);
    assert.equal(jarvisMassing({ ...dossier, objectif: 'Immeuble collectif' }), null);
    assert.equal(jarvisMassing({ ...dossier, dimensions: '900 m sur 14 m' }), null);
  });

  it('reconnaît les choix visuels explicites et les transmet à Studio', () => {
    const dossier = parseJarvisDraft({ version: 1, objectif: 'Immeuble collectif R+5', localisation: null,
      programme: '12 logements', dimensions: '30 m sur 14 m',
      style: 'Façade en brique, toiture à deux pans et baies vitrées', contraintes: null, questions: [], pieces: [] });
    assert.ok(dossier);
    assert.deepEqual(jarvisAppearance(dossier), { facade: 'brique', roof: 'deux-pans', openings: 'baies-vitrees', ...noVolumeStyle });
    assert.equal(studioCommand(dossier), 'Crée un immeuble collectif R+5 de 30 m sur 14 m en brique, toiture à deux pans, baies vitrées.');
    assert.deepEqual(jarvisAppearance({ ...dossier, style: 'Façade en bois, toiture-terrasse et fenêtres verticales' }),
      { facade: 'bois', roof: 'terrasse', openings: 'fenetres-verticales', ...noVolumeStyle });
    assert.deepEqual(jarvisAppearance({ ...dossier, style: null }), { facade: null, roof: null, openings: null, ...noVolumeStyle });
    assert.deepEqual(jarvisAppearance({ ...dossier, objectif: 'Immeuble collectif R+5 en brique, toiture-terrasse', style: 'Façade en bois, toiture à deux pans' }),
      { facade: 'bois', roof: 'deux-pans', openings: null, ...noVolumeStyle });
  });

  it('répare une fiche validée qui a remplacé le bâtiment par la dernière consigne', () => {
    const saved = parseJarvisDraft({ version: 1,
      objectif: 'Mets une façade en brique, une toiture à deux pans et des baies vitrées.',
      localisation: null, programme: '12 logements', dimensions: '30 m sur 14 m', style: null,
      contraintes: null, questions: [], pieces: [] });
    assert.ok(saved);
    const messages = [
      { role: 'user', text: 'Prépare une maquette 3D d’un immeuble collectif R+5 de 30 m sur 14 m, avec 12 logements.', createdAt: '2026-10-13T06:00:00Z' },
      { role: 'user', text: 'Mets une façade en brique, une toiture à deux pans et des baies vitrées.', createdAt: '2026-10-13T06:05:00Z' },
    ];
    const repaired = reconcileJarvisDraft(saved, messages, '2026-10-13T06:06:00Z');
    assert.match(repaired.objectif!, /immeuble collectif R\+5/);
    assert.equal(repaired.style, 'Façade en brique, toiture à deux pans, baies vitrées');
    assert.equal(jarvisMassing(repaired)?.niveaux, 6);
    assert.equal(studioCommand(repaired), 'Crée un immeuble collectif R+5 de 30 m sur 14 m en brique, toiture à deux pans, baies vitrées.');
    assert.equal(reconcileJarvisDraft({ ...saved, style: 'Façade en bois' }, messages, '2026-10-13T06:06:00Z').style,
      'Façade en bardage bois, toiture à deux pans, baies vitrées');
  });

  it('esquisse différentes emprises et interprète un toit simplement demandé en pente', () => {
    const base = parseJarvisDraft({ version: 1, objectif: 'Immeuble collectif R+5', localisation: null,
      programme: '12 logements', dimensions: '30 m sur 14 m', style: null, contraintes: null, questions: [], pieces: [] });
    assert.ok(base);
    for (const [phrase, forme, parts] of [
      ['forme en L', 'l', 2], ['forme en U', 'u', 3], ['forme en T', 't', 2], ['forme en H', 'h', 3],
      ['avec cour intérieure', 'cour', 4], ['en gradins', 'gradins', 1], ['tour sur socle', 'socle-tour', 1],
    ] as const) {
      const massing = jarvisMassing({ ...base, style: phrase });
      assert.ok(massing, phrase);
      assert.equal(massing.appearance.shape, forme);
      assert.equal(levelFootprint(massing, 0).length, parts);
      assert.match(studioCommand({ ...base, style: phrase })!, /en forme de|cour intérieure|en gradins|sur un socle/);
    }
    const stepped = jarvisMassing({ ...base, style: 'bâtiment en gradins' })!;
    assert.ok(levelFootprint(stepped, 5)[0].depth < levelFootprint(stepped, 0)[0].depth);
    const podium = jarvisMassing({ ...base, style: 'tour sur socle' })!;
    assert.ok(levelFootprint(podium, 1)[0].width < levelFootprint(podium, 0)[0].width);
    const slope = jarvisMassing({ ...base, style: 'ajoute des briques et un toit en pente' })!;
    assert.equal(slope.appearance.facade, 'brique');
    assert.equal(slope.appearance.roof, 'pente');
    assert.equal(previewRoof(slope), 'deux-pans');
    assert.match(studioCommand({ ...base, style: 'ajoute des briques et un toit en pente' })!, /toiture à deux pans/);
  });

  it('prépare deux bâtiments de dimensions et hauteurs indépendantes', () => {
    const draft = latestJarvisDraft([
      { role: 'user', text: 'Prépare une maquette 3D avec bâtiment A R+5 de 30 m sur 14 m en U et bâtiment B R+3 de 20 m sur 12 m en L, séparés de 12 m.' },
    ]);
    assert.ok(draft);
    const massing = jarvisMassing(draft);
    assert.ok(massing?.buildings);
    assert.deepEqual(massing.buildings.map(building => [building.name, building.largeurM, building.profondeurM, building.niveaux, building.appearance.shape]),
      [['Bâtiment A', 30, 14, 6, 'u'], ['Bâtiment B', 20, 12, 4, 'l']]);
    assert.equal(massing.separationM, 12);
    const transfer = studioComposition(draft);
    assert.ok(transfer);
    assert.equal(transfer.length, 2);
    assert.match(transfer[0].commande, /R\+5 de 30 m sur 14 m, en forme de U/);
    assert.match(transfer[1].commande, /R\+3 de 20 m sur 12 m, en forme de L/);
    assert.equal(transfer[1].centreZ - transfer[0].centreZ, 25);
  });

  it('prépare un seul bâtiment à trois parties, hauteurs et retraits distincts', () => {
    const draft = latestJarvisDraft([{ role: 'user', text: 'Prépare une maquette 3D d’un immeuble : aile gauche R+3 de 10 m sur 12 m avec retrait de 2 m, partie centrale R+5 de 10 m sur 14 m, aile droite R+4 de 10 m sur 12 m avec retrait de 3 m. Façade en brique.' }]);
    assert.ok(draft);
    const massing = jarvisMassing(draft);
    assert.ok(massing?.segments);
    assert.equal(massing.buildings, undefined);
    assert.deepEqual(facadeRules(draft), []);
    assert.deepEqual(massing.segments.map(part => [part.largeurM, part.profondeurM, part.niveaux, part.retraitM]), [[10, 12, 4, 2], [10, 14, 6, 0], [10, 12, 5, 3]]);
    assert.equal(levelFootprint(massing, 0).length, 3);
    assert.equal(levelFootprint(massing, 4).length, 2);
    assert.equal(levelFootprint(massing, 5).length, 1);
    assert.equal(studioSegmentedVolume(draft)?.length, 3);
    assert.match(studioCommand(draft)!, /R\+3/);
  });

  it('crée des décrochés de façade mesurés et les transmet dans un seul bâtiment', () => {
    const draft = latestJarvisDraft([
      { role: 'user', text: 'Prépare une maquette 3D d’un immeuble collectif R+5 de 30 m sur 14 m.' },
      { role: 'user', text: 'Ajoute des décrochés de façade de 1,5 m pour éviter un mur lisse.' },
    ]);
    assert.ok(draft);
    const massing = jarvisMassing(draft);
    assert.ok(massing);
    assert.equal(massing.appearance.articulation?.depthM, 1.5);
    const parts = levelFootprint(massing, 0);
    assert.equal(parts.length, 5);
    assert.deepEqual(parts.map(part => part.depth), [14, 12.5, 14, 12.5, 14]);
    assert.ok(parts.every(part => Math.abs(part.z + part.depth / 2 - 7) < 0.001));
    assert.equal(studioSegmentedVolume(draft)?.length, 5);
  });

  it('garde les décrochés sur les ailes de hauteurs différentes', () => {
    const draft = latestJarvisDraft([{ role: 'user', text: 'Prépare une maquette 3D d’un immeuble : aile gauche R+3 de 10 m sur 12 m, partie centrale R+5 de 10 m sur 14 m, aile droite R+4 de 10 m sur 12 m. Ajoute des décrochés de façade de 1 m.' }]);
    assert.ok(draft);
    const massing = jarvisMassing(draft);
    assert.ok(massing?.segments);
    assert.equal(levelFootprint(massing, 0).length, 9);
    assert.equal(levelFootprint(massing, 5).length, 3);
    const volume = studioSegmentedVolume(draft);
    assert.equal(volume?.length, 9);
    assert.deepEqual(volume?.map(part => part.niveaux), [4, 4, 4, 6, 6, 6, 5, 5, 5]);
  });

  it('distingue le retrait d’une aile de la profondeur des décrochés de façade', () => {
    const draft = latestJarvisDraft([{ role: 'user', text: 'Prépare une maquette 3D : aile gauche R+3 de 10 m sur 12 m avec retrait de 2 m, partie centrale R+5 de 10 m sur 14 m, aile droite R+4 de 10 m sur 12 m. Ajoute des décrochés de façade de 1 m.' }]);
    assert.ok(draft);
    assert.equal(jarvisMassing(draft)?.appearance.articulation?.depthM, 1);
    assert.equal(studioSegmentedVolume(draft)?.length, 9);
  });

  it('place un retrait central dès R+3 et une avancée à droite au RDC', () => {
    const draft = latestJarvisDraft([
      { role: 'user', text: 'Prépare une maquette 3D d’un immeuble collectif R+5 de 30 m sur 14 m.' },
      { role: 'user', text: 'Sur la façade sud, recule les 8 mètres centraux de 2 mètres à partir du R+3, et avance l’aile droite de 1 mètre au rez-de-chaussée.' },
    ]);
    assert.ok(draft);
    assert.deepEqual(facadeRules(draft).map(rule => [rule.side, rule.position, rule.depthM, rule.fromLevel, rule.toLevel]),
      [['sud', 'centre', 2, 3, null], ['sud', 'droite', 1, 0, 0]]);
    const massing = jarvisMassing(draft)!;
    assert.equal(massing.appearance.articulation, null);
    assert.ok(levelFootprint(massing, 0).some(part => part.z - part.depth / 2 < -7));
    assert.ok(levelFootprint(massing, 3).some(part => Math.abs(part.width - 8) < .01 && Math.abs(part.z - part.depth / 2 + 5) < .01));
    assert.ok(levelFootprint(massing, 1).every(part => Math.abs(part.z - part.depth / 2 + 7) < .01));
    const volume = studioSegmentedVolume(draft);
    assert.ok(volume);
    assert.ok(volume.some(part => part.fromLevelIndex === 3 && part.niveaux === 6 && Math.abs(part.largeurM - 8) < .01), JSON.stringify(volume));
    assert.ok(volume.some(part => part.fromLevelIndex === 0 && part.niveaux === 1 && part.x > 0));
  });
});
