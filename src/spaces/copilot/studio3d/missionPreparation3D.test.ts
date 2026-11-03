import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as projetChat from './projetChat.ts';
import * as jarvisDraft from './jarvisDraft.ts';
import * as preparation from './preparation3D.ts';
import { attendreMissionCourante, chargerPointDeDepart, creerActionVisualisationMission, ficheObjectifMission, iduAttenduMission, iduDeParcelle, MaquetteDejaChargeeError, missionVisualisable, normaliserIdu, preparerTransfertMission, referencesMission, verifierTerrainMission } from './missionPreparation3D.ts';
import type { Mission } from '../agent/agent.types.ts';
const mission = (p: Partial<Mission> = {}): Mission => ({ id: 'm1', conversation_id: 'c1', type: 'faisabilite', statut: 'en_cours', objectif: 'Construction de 24 logements', erreur: null, criteres: null, rapport: null, ...p } as Mission);
test('mission serveur lancée éligible, logements pluriels et plusieurs bâtiments acceptés', () => {
  for (const statut of ['en_attente','en_cours','attente_utilisateur','terminee','budget_atteint']) assert.equal(missionVisualisable(mission({ statut }), 'c1'), true);
  assert.equal(missionVisualisable(mission({ objectif: 'Deux bâtiments R+2 de logements' }), 'c1'), true);
});
test('devis même expiré, annulation, échec, inconnu, conception et prospection exclus', () => {
  for (const statut of ['devis','annulee','echec','inconnu']) assert.equal(missionVisualisable(mission({ statut }), 'c1'), false);
  for (const type of ['conception','prospection_fonciere','etude_marche','veille']) assert.equal(missionVisualisable(mission({ type }), 'c1'), false);
  assert.equal(missionVisualisable(mission({ erreur: 'erreur serveur' }), 'c1'), false);
  assert.equal(missionVisualisable(mission({ objectif: 'Étude de marché nationale' }), 'c1'), false);
});
test('conversation absente ou différente refusée', () => {
  assert.equal(missionVisualisable(mission(), null), false); assert.equal(missionVisualisable(mission(), 'autre'), false);
});
test('plusieurs terrains dans texte, critères ou rapport : pas de choix arbitraire', () => {
  for (const objectif of ['Construction sur 12 terrains', 'Construction sur plusieurs parcelles', 'Comparer deux terrains pour un immeuble']) assert.equal(missionVisualisable(mission({ objectif }), 'c1'), false);
  assert.equal(missionVisualisable(mission({ criteres: { parcelles: ['a','b'] } }), 'c1'), false);
  assert.equal(missionVisualisable(mission({ rapport: { terrains: [{ idu:'a' },{ idu:'b' }] } as Mission['rapport'] }), 'c1'), false);
});
test('fiche mission laisse inconnus vides, ignore critères géométriques sans contrat', () => {
  const f = ficheObjectifMission(mission({ criteres: { largeur: 30, niveaux: 4 } }));
  assert.equal(f.objectif, 'Construction de 24 logements'); assert.equal(f.dimensions, null); assert.equal(f.programme, null); assert.equal(f.localisation, null);
});
const A = '93048000AJ0209', B = '93048000AJ0210';
test('identifiant parcelle attendu et confirmation mission/conversation exactes', () => {
  assert.equal(iduAttenduMission(mission({ criteres: { idu: A } })), A);
  assert.equal(iduAttenduMission(mission({ rapport: { terrains: [{ idu: B }] } as Mission['rapport'] })), B);
  assert.equal(iduAttenduMission(mission({ criteres: { idu: 'a' } })), null, 'référence illisible : non retenue comme attendue');
  assert.throws(() => verifierTerrainMission('m1','c1',{ missionId:'m2',conversationId:'c1',parcelId:A },A), /autre mission/);
  assert.throws(() => verifierTerrainMission('m1','c1',{ missionId:'m1',conversationId:'c2',parcelId:A },A), /autre mission/);
  assert.throws(() => verifierTerrainMission('m1','c1',{ missionId:'m1',conversationId:'c1',parcelId:B },A), /correspond pas/);
});
test('doubleclic pendant relecture : une seule ouverture sans relancer mission', async () => {
  let finir!: (m: Mission) => void, lectures=0, ouvertures=0;
  const attente = new Promise<Mission>(r => { finir=r; });
  const action = creerActionVisualisationMission({ missionId:'m1', conversationId:'c1', courante:()=>true, lire:async()=>{lectures++;return attente;}, ouvrir:()=>{ouvertures++;} });
  const a=action(),b=action(); assert.equal(lectures,1); finir(mission()); await Promise.all([a,b]); assert.equal(ouvertures,1);
});
test('statut ou identité serveur changée et navigation pendant attente : aucune ouverture', async () => {
  for (const m of [mission({id:'m2'}),mission({statut:'annulee'}),mission({conversation_id:'c2'})]) {
    let ouvert=false; const a=creerActionVisualisationMission({ missionId:'m1',conversationId:'c1',courante:()=>true,lire:async()=>m,ouvrir:()=>{ouvert=true;} });
    await assert.rejects(a()); assert.equal(ouvert,false);
  }
  const a=creerActionVisualisationMission({ missionId:'m1',conversationId:'c1',courante:()=>false,lire:async()=>mission(),ouvrir:()=>{throw Error('ouverture interdite');} });
  await assert.rejects(a(),/changé/);
});
test('préparation locale ne contient aucun appel de facturation, lancement ou envoi IA', () => {
  const s=readFileSync(new URL('./MissionPreparation3DPanel.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(s,/validerDevis|sendMessage|onSend|saveJarvisDraft|refreshCredits/);
  const charge=readFileSync(new URL('./chargeVoirEn3D.ts',import.meta.url),'utf8');
  assert.match(charge,/options.autoriserEtudeActive === false \? null : getActiveStudyId\(\)/);
});

test('parcelle unique du rapport contradictoire avec critères refuse éligibilité', () => {
  assert.equal(missionVisualisable(mission({ criteres:{idu:'a'}, rapport:{terrains:[{idu:'b'}]} as Mission['rapport'] }), 'c1'), false);
});
test('raccordement sans onSend : statut relu et conversation contrôlée avant et après transfert', () => {
  const base = new URL('../', import.meta.url);
  const carte=readFileSync(new URL('agent/CarteDevisMission.tsx',base),'utf8');
  assert.match(carte,/missionVisualisable\(mission, conversationId/); assert.match(carte,/lire: lireMissionParId/);
  const message=readFileSync(new URL('components/CopilotMessage.tsx',base),'utf8'); assert.match(message,/onVisualiserMission=\{onVisualiserMission\}/);
  const chat=readFileSync(new URL('components/CopilotChat.tsx',base),'utf8'); assert.match(chat,/onVisualiserMission=\{onVisualiserMission\}/);
  const page=readFileSync(new URL('MimmozIAPage.tsx',base),'utf8');
  assert.ok(page.indexOf('verifierContexteMission();') < page.indexOf('await preparerTransfertMission'));
  assert.match(page,/await preparerTransfertMission[\s\S]*?verifierContexteMission\(\);/);
  assert.match(page,/autoriserEtudeActive: options\?\.mission !== true/);
});

test('navigation pendant attente charge : aucun résultat transmis à l’ouverture de Studio', async () => {
  let courante = true, finir!: () => void, ouvert = false;
  const attente = new Promise<void>(r => { finir=r; });
  const transfert = attendreMissionCourante(() => courante, () => attente).then(() => { ouvert=true; });
  courante=false; finir(); await assert.rejects(transfert,/changé pendant/); assert.equal(ouvert,false);
  let io=0;
  await assert.rejects(attendreMissionCourante(() => false, async()=>{io++;}),/changé/); assert.equal(io,0);
});

test('charge réelle mission : ne consulte pas étude active et conserve le lien existant uniquement', async () => {
  const source=readFileSync(new URL('./chargeVoirEn3D.ts',import.meta.url),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const conv='22345678-1234-4234-8234-123456789abc';
  const liee='12345678-1234-1234-1234-123456789abc';
  const stockage=new Map<string,string>([['mzia.studio.etude.'+conv,liee]]);
  const avantWindow=Object.getOwnPropertyDescriptor(globalThis,'window'), avantStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  let lecturesActives=0;
  Object.defineProperty(globalThis,'window',{configurable:true,value:{location:{origin:'https://mimmoza.test',href:'https://mimmoza.test/chat'}}});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>stockage.get(k)??null,setItem:(k:string,v:string)=>stockage.set(k,v)}});
  const charger=(nom:string):unknown=>{
    if(nom==='./preparation3D')return preparation;
    if(nom==='./jarvisDraft')return jarvisDraft;
    if(nom==='./projetChat')return projetChat;
    if(nom==='./jarvisFiles')return {listJarvisTransferFiles:async()=>[]};
    if(nom==='./reliefCache')return {reliefEnCache:async()=>null,memoriserRelief:async()=>{}};
    if(nom==='./parcelFromGps')return {parcelId:()=> 'parcelle-1'};
    if(nom==='./transfertStudio')return {signerTransferts:async()=>[]};
    if(nom.includes('promoteurSnapshot.store'))return {getActiveStudyId:()=>{lecturesActives++;throw Error('Étude active interdite');}};
    if(nom.includes('environnement360'))return {};
    throw Error('Dépendance non prévue '+nom);
  };
  try{
    const exports:Record<string,unknown>={};new Function('require','exports',js)(charger,exports);
    const lancer=exports.preparerChargeVoirEn3D as (...args:unknown[])=>Promise<{etudeId:string|null;construit:{ok:boolean}}>;
    const f=ficheObjectifMission(mission());f.objectif='Maison R+1';f.dimensions='20 m sur 10 m';
    const terrain={parcel:{type:'Feature',properties:{code_insee:'93048'},geometry:{type:'Polygon',coordinates:[[[2,48],[2.001,48],[2.001,48.001],[2,48.001],[2,48]]]}},point:{lat:48,lon:2}};
    const r=await lancer(f,conv,terrain,undefined,{autoriserEtudeActive:false});
    assert.equal(lecturesActives,0);assert.equal(r.etudeId,liee);assert.equal(r.construit.ok,true,JSON.stringify(r.construit));
    stockage.clear();const sans=await lancer(f,'c1',terrain,undefined,{autoriserEtudeActive:false});
    assert.equal(sans.etudeId,null);assert.equal(lecturesActives,0);assert.equal(stockage.size,0);
  }finally{
    if(avantWindow)Object.defineProperty(globalThis,'window',avantWindow);else Reflect.deleteProperty(globalThis,'window');
    if(avantStorage)Object.defineProperty(globalThis,'localStorage',avantStorage);else Reflect.deleteProperty(globalThis,'localStorage');
  }
});

// ---------------- Lot B ----------------
test('M1 IDU normalisé : espaces et minuscules acceptés, IDU différente refusée, illisible refusé si attendu', () => {
  assert.equal(normaliserIdu(' 93048 000 aj 0209 '), A); assert.equal(normaliserIdu('2A004000AB0012'), '2A004000AB0012');
  assert.equal(normaliserIdu('AJ 209'), null); assert.equal(normaliserIdu('93048000AJ209'), null);
  for (const idu of ['93048 000 AJ 0209', '93048000aj0209', ' 93048000AJ0209 ']) {
    const m = mission({ criteres: { idu } });
    assert.equal(iduAttenduMission(m), A);
    assert.doesNotThrow(() => verifierTerrainMission('m1','c1',{ missionId:'m1',conversationId:'c1',parcelId:A }, iduAttenduMission(m)));
    assert.doesNotThrow(() => verifierTerrainMission('m1','c1',{ missionId:'m1',conversationId:'c1',parcelId:'93048 000 aj 0209' }, iduAttenduMission(m)));
    assert.throws(() => verifierTerrainMission('m1','c1',{ missionId:'m1',conversationId:'c1',parcelId:B }, iduAttenduMission(m)), /correspond pas/);
  }
  assert.throws(() => verifierTerrainMission('m1','c1',{ missionId:'m1',conversationId:'c1',parcelId:'AJ 209' }, A), /illisible/);
  // Critère avec espaces et rapport normalisé : même parcelle, bouton conservé.
  assert.equal(missionVisualisable(mission({ criteres:{ idu:'93048 000 AJ 0209' }, rapport:{ terrains:[{ idu:A }] } as Mission['rapport'] }), 'c1'), true);
});
test('M1 parcelle : IDU lu dans les propriétés ou reconstruit, jamais le libellé', () => {
  assert.equal(iduDeParcelle({ properties: { idu: '93048000aj0209' } }), A);
  assert.equal(iduDeParcelle({ properties: { id: 'parcelle-x', code_insee: '93048', section: 'AJ', numero: '209' } }), A);
  assert.equal(iduDeParcelle({ properties: { code_insee: '93048', com_abs: '000', section: 'B', numero: '12' } }), '930480000B0012');
  assert.equal(iduDeParcelle({ properties: { section: 'AJ', numero: '209' } }), null);
  assert.equal(iduDeParcelle({ properties: null }), null);
});
test('M1 clés de critères élargies : parcelle, références cadastrales, listes', () => {
  assert.equal(iduAttenduMission(mission({ criteres: { parcelle: '93048 000 AJ 0209' } })), A);
  assert.equal(iduAttenduMission(mission({ criteres: { reference_cadastrale: A } })), A);
  assert.equal(iduAttenduMission(mission({ criteres: { references_cadastrales: [A] } })), A);
  assert.equal(iduAttenduMission(mission({ criteres: { parcelles: [{ idu: A }] } })), A);
  assert.equal(referencesMission(mission({ criteres: { references_cadastrales: [A, B] } })).plusieurs, true);
  assert.equal(missionVisualisable(mission({ criteres: { references_cadastrales: [A, B] } }), 'c1'), false);
  assert.equal(missionVisualisable(mission({ criteres: { idu: A, parcelle: B } }), 'c1'), false, 'critères contradictoires');
  assert.equal(missionVisualisable(mission({ criteres: { idu: A }, rapport: { terrains: [{ idu: B }] } as Mission['rapport'] }), 'c1'), false);
  assert.equal(missionVisualisable(mission({ criteres: { parcelle: 'au fond de la rue' } }), 'c1'), true, 'texte libre non cadastral ignoré');
});
test('m6 éligibilité sans mots exacts, exclusion multi-terrains conservée', () => {
  for (const objectif of ['Étude de faisabilité de la parcelle 93048000AJ0209', 'Faisabilité R+3 à Montreuil', 'Faisabilité du terrain rue de Paris', 'Que peut-on faire ici ?'])
    assert.equal(missionVisualisable(mission({ objectif, criteres: objectif.startsWith('Que') ? { idu: A } : null }), 'c1'), true, objectif);
  assert.equal(missionVisualisable(mission({ type: 'libre', objectif: 'Analyse libre' }), 'c1'), false);
  assert.equal(missionVisualisable(mission({ type: 'libre', objectif: 'Analyse libre', criteres: { idu: A } }), 'c1'), true);
  for (const objectif of ['Faisabilité sur deux parcelles', 'Comparer la faisabilité de 3 terrains', 'Rechercher un terrain constructible', 'Étude de marché nationale'])
    assert.equal(missionVisualisable(mission({ objectif }), 'c1'), false, objectif);
});
test('M2 maquette d’une autre conversation : refus AVANT toute I/O, issue explicite, remplacement sur confirmation', async () => {
  let io = 0; const preparer = async () => { io++; return 'charge'; };
  const autre = () => ({ chargee: true, conversationId: 'c-autre' });
  await assert.rejects(preparerTransfertMission({ conversationId: 'c1', remplacer: false, maquette: autre, courante: () => true, preparer }),
    (e: unknown) => e instanceof MaquetteDejaChargeeError && !e.memeConversation && /autre conversation/.test(e.message) && /Remplacez|fermez/.test(e.message));
  assert.equal(io, 0);
  await assert.rejects(preparerTransfertMission({ conversationId: 'c1', remplacer: false, maquette: () => ({ chargee: true, conversationId: 'c1' }), courante: () => true, preparer }),
    (e: unknown) => e instanceof MaquetteDejaChargeeError && e.memeConversation);
  assert.equal(io, 0);
  assert.equal(await preparerTransfertMission({ conversationId: 'c1', remplacer: true, maquette: autre, courante: () => true, preparer }), 'charge'); assert.equal(io, 1);
  assert.equal(await preparerTransfertMission({ conversationId: 'c1', remplacer: false, maquette: () => ({ chargee: false, conversationId: null }), courante: () => true, preparer }), 'charge'); assert.equal(io, 2);
  // Maquette chargée pendant l'attente : refus après, rien n'est ouvert.
  let chargee = false;
  await assert.rejects(preparerTransfertMission({ conversationId: 'c1', remplacer: false, maquette: () => ({ chargee, conversationId: 'c2' }), courante: () => true,
    preparer: async () => { chargee = true; return 'x'; } }), MaquetteDejaChargeeError);
  // Conversation changée : aucune I/O non plus.
  let io2 = 0;
  await assert.rejects(preparerTransfertMission({ conversationId: 'c1', remplacer: true, maquette: autre, courante: () => false, preparer: async () => { io2++; } }), /changé/);
  assert.equal(io2, 0);
});
test('M2/m7 raccordement page : contrôle avant I/O, maquette déchargée explicitement, pas de parcelle retenue en mission', () => {
  const page = readFileSync(new URL('../MimmozIAPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /maquette: \(\) => \(\{ chargee: !!studio3dRef\.current\.demande, conversationId: studio3dRef\.current\.conversationId \}\)/);
  assert.match(page, /const fermerMaquette3d = useCallback\(\(\) => \{[\s\S]*?setStudio3d\(\{ demande: null, ouvert: false, empreinte: null, conversationId: null \}\)/);
  assert.match(page, /onFermerMaquette=\{fermerMaquette3d\}/);
  assert.doesNotMatch(page, /Une maquette est déjà chargée dans Studio/);
  const retenues = [...page.matchAll(/retenirParcelle\(/g)].length;
  assert.equal(retenues, 1); assert.match(page, /if \(terrainArg && !options\?\.mission\) retenirParcelle\(conversationId, terrainArg\);/);
  // m8 : la confirmation vient du panneau (parcelle.missionId), pas reconstruite depuis la préparation.
  assert.match(page, /\{ missionId: parcelle\.missionId, conversationId: parcelle\.conversationId, parcelId: iduDeParcelle\(parcelle\.valeur\.parcel\) \?\? parcelle\.parcelId \}/);
  assert.doesNotMatch(page, /missionId: preparation\.mission\.id, conversationId: preparation\.mission\.conversation_id!/);
});
test('m8 confirmation d’une autre mission refusée même parcelle identique', () => {
  assert.throws(() => verifierTerrainMission('m1', 'c1', { missionId: 'm0', conversationId: 'c1', parcelId: A }, A), /autre mission/);
  assert.throws(() => verifierTerrainMission('m1', 'c1', { missionId: 'm1', conversationId: 'c0', parcelId: A }, null), /autre mission/);
});
test('M3 point de départ = fiche ENREGISTRÉE, repli annoncé si aucune ou illisible', async () => {
  const enregistree = { ...ficheObjectifMission(mission()), objectif: 'Immeuble R+3 corrigé', dimensions: '20 m sur 10 m' };
  const lus: string[] = [];
  const r = await chargerPointDeDepart('c1', async id => { lus.push(id); return { draft: enregistree, status: 'validated', updatedAt: '2026-11-01T10:00:00Z' }; });
  assert.deepEqual(lus, ['c1']); assert.equal(r.type, 'enregistree');
  if (r.type === 'enregistree') { assert.equal(r.fiche, enregistree); assert.equal(r.statut, 'validated'); }
  assert.deepEqual(await chargerPointDeDepart('c1', async () => null), { type: 'aucune' });
  const e = await chargerPointDeDepart('c1', async () => { throw new Error('réseau'); });
  assert.equal(e.type, 'erreur');
  const panneau = readFileSync(new URL('./MissionPreparation3DPanel.tsx', import.meta.url), 'utf8');
  assert.match(panneau, /chargerFiche = loadJarvisDraft/); assert.match(panneau, /Reprendre la fiche 3D enregistrée/);
  assert.match(panneau, /Aucune fiche 3D enregistrée dans cette conversation/);
  assert.doesNotMatch(panneau, /latestJarvisDraft|existante/);
  const page = readFileSync(new URL('../MimmozIAPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /setMission3d\(\{ mission \}\)/);
});
