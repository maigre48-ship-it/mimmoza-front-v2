// LOT E1-suivi — Carte « Rendu en cours » du chat : repérage, états, fichiers du résultat.
// Les fichiers du résultat sont comparés à ceux que renvoie le CODE RÉEL de studio_etat_rendu
// (copilot-chat/agent/studio.ts) sur un dépôt factice : aucune règle divergente.
// Identifiants, chemins et horaires SYNTHÉTIQUES.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVITE_RECENTE_MS as ACTIVITE_SERVEUR, ATTENTE_SUSPECTE_MS as ATTENTE_SERVEUR, executerOutilStudio, type DepotStudio, type TravailLu,
} from '../../../../supabase/functions/copilot-chat/agent/studio.ts';
import { lireTravail, type TravailStudio } from '../../../lib/studio/travauxLogique.ts';
import {
  ACTIVITE_RECENTE_MS, ATTENTE_SUSPECTE_MS, cartesSuivi, dureeLisible, fichiersResultat, lireIndiceSuivi, vueCarteSuivi, type IndiceSuivi,
} from './suiviRenduChat.ts';

const JOB = '3f1c0e00-0000-4000-8000-0000000000a1';
const JOB2 = '3f1c0e00-0000-4000-8000-0000000000a2';
const T0 = Date.parse('2026-11-05T16:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

const appel = (id: string, name: string, data: Record<string, unknown>, status = 'success', ok = 'ok') =>
  ({ id, name, status, output: { status: ok, source: 'MimmozIA · Studio 3D', data } });

const ligne = (p: Partial<TravailLu> & { maj_le?: string; options?: unknown }): Record<string, unknown> => ({
  id: JOB, conversation_id: 'c1', type: 'image', statut: 'en_attente', progression: 0, etape: null, resultat: null,
  elements_omis: [], erreur: null, cree_le: iso(T0), maj_le: iso(T0), demarre_le: null, termine_le: null, options: {}, ...p,
});
const travail = (p: Parameters<typeof ligne>[0]): TravailStudio => { const t = lireTravail(ligne(p)); assert.ok(t); return t; };
const INDICE_LANCE: IndiceSuivi = { jobId: JOB, origine: 'lance', type: 'image', statut: 'en_attente', machine: 'La machine de rendu a été active il y a 3 min.', positionFile: null };

test('seuils identiques à ceux du serveur (studio.ts)', () => {
  assert.equal(ATTENTE_SUSPECTE_MS, ATTENTE_SERVEUR);
  assert.equal(ACTIVITE_RECENTE_MS, ACTIVITE_SERVEUR);
});

test('lireIndiceSuivi : lancé, déjà lancé, état ; un devis, une erreur ou un identifiant invalide ne suivent rien', () => {
  assert.deepEqual(lireIndiceSuivi(appel('a', 'studio_lancer_rendu', { lance: true, job_id: JOB, type: 'image', statut: 'en_attente', machine: 'Machine X.' })),
    { jobId: JOB, origine: 'lance', type: 'image', statut: 'en_attente', machine: 'Machine X.', positionFile: null });
  assert.equal(lireIndiceSuivi(appel('a', 'studio_lancer_rendu', { deja_lance: true, job_id: JOB, type: 'film', statut: 'termine' }))?.origine, 'deja_lance');
  const etat = lireIndiceSuivi(appel('a', 'studio_etat_rendu', { job_id: JOB, type: 'visite360', statut: 'en_attente', position_file: 2, machine: 'M.' }));
  assert.equal(etat?.origine, 'etat');
  assert.equal(etat?.positionFile, 2);
  // Devis (temps 1) : rien n'est lancé.
  assert.equal(lireIndiceSuivi(appel('a', 'studio_lancer_rendu', { devis: true, jeton_devis: 'x', type: 'image' })), null);
  assert.equal(lireIndiceSuivi(appel('a', 'studio_lancer_rendu', { lance: true, job_id: JOB }, 'error')), null);
  assert.equal(lireIndiceSuivi(appel('a', 'studio_lancer_rendu', { lance: true, job_id: JOB }, 'success', 'error')), null);
  assert.equal(lireIndiceSuivi(appel('a', 'studio_lancer_rendu', { lance: true, job_id: 'pas-un-uuid' })), null);
  assert.equal(lireIndiceSuivi({ id: 'a', name: 'studio_lancer_rendu', status: 'running' }), null);
  assert.equal(lireIndiceSuivi(appel('a', 'autre_outil', { lance: true, job_id: JOB })), null);
});

test('E1-rendu : garde du brief (statut partial, brief_requis) et devis avec habillage → carte d’outil habituelle, jamais une carte de suivi', () => {
  // Sortie de la garde E1-brief (studio.ts::demandeBrief) : aucune ligne studio_jobs, aucun job_id.
  const garde = appel('g', 'studio_lancer_rendu', {
    brief_requis: true, type: 'image', champs: { style: { valeurs: ['contemporain'], defaut: 'contemporain' }, attique: { valeurs: [false, true], defaut: false } },
    question: 'Avant d’établir le devis, quelques choix…\n- Style architectural : contemporain',
  }, 'success', 'partial');
  assert.equal(lireIndiceSuivi(garde), null);
  // Même si un job_id traînait dans une sortie partielle, elle ne suit rien (seul status « ok » compte).
  assert.equal(lireIndiceSuivi(appel('g2', 'studio_lancer_rendu', { brief_requis: true, job_id: JOB }, 'success', 'partial')), null);
  // Devis (statut confirmation_requise) portant le nouveau champ devis.habillage.
  const devis = appel('d', 'studio_lancer_rendu', {
    jeton_devis: 'x', type: 'image', devis: { habillage: 'style contemporain (par défaut) · façade brique · loggias · avec attique', avertissements: ['Ensemble de 2 bâtiments : …'] },
  }, 'success', 'confirmation_requise');
  assert.equal(lireIndiceSuivi(devis), null);
  const cartes = cartesSuivi([{ toolCalls: [garde, devis] }, { toolCalls: [appel('l', 'studio_lancer_rendu', { lance: true, job_id: JOB, type: 'image', statut: 'en_attente' })] }]);
  assert.deepEqual([...cartes.keys()], ['l']);
});

test('cartesSuivi : une seule carte vivante par travail, sur le DERNIER appel qui le cite', () => {
  const messages = [
    { toolCalls: [appel('devis', 'studio_lancer_rendu', { devis: true })] },
    { toolCalls: [appel('lance', 'studio_lancer_rendu', { lance: true, job_id: JOB, type: 'image', statut: 'en_attente' })] },
    { toolCalls: [appel('autre', 'studio_lancer_rendu', { lance: true, job_id: JOB2, type: 'film', statut: 'en_attente' })] },
    { toolCalls: [appel('etat', 'studio_etat_rendu', { job_id: JOB, type: 'image', statut: 'en_cours' })] },
    { toolCalls: undefined },
  ];
  const cartes = cartesSuivi(messages);
  assert.deepEqual([...cartes.keys()].sort(), ['autre', 'etat']);
  assert.equal(cartes.get('etat')?.jobId, JOB);
  assert.equal(cartes.has('lance'), false);
});

test('vue : chargement puis introuvable', () => {
  assert.equal(vueCarteSuivi(null, INDICE_LANCE, T0).etat, 'chargement');
  assert.equal(vueCarteSuivi(null, INDICE_LANCE, T0).actif, true);
  const v = vueCarteSuivi(null, INDICE_LANCE, T0, true);
  assert.equal(v.etat, 'introuvable');
  assert.equal(v.actif, false);
});

test('vue en attente : phrase datée de la machine, puis signal honnête au-delà de 10 min', () => {
  const t = travail({ statut: 'en_attente' });
  const v = vueCarteSuivi(t, INDICE_LANCE, T0 + 3 * 60_000);
  assert.equal(v.actif, true);
  assert.equal(v.progression, null);
  assert.match(v.phrase, /pas encore pris \(en attente depuis 3 min\)/);
  assert.deepEqual(v.details, ['Au moment du lancement : La machine de rendu a été active il y a 3 min.']);
  assert.equal(v.alerte, null);
  const tard = vueCarteSuivi(t, INDICE_LANCE, T0 + 25 * 60_000);
  assert.match(tard.alerte ?? '', /pas encore été pris après 25 min d’attente : la machine de rendu est peut-être éteinte/);
  // Position dans la file : seulement si studio_etat_rendu l'a donnée.
  const etat = vueCarteSuivi(t, { ...INDICE_LANCE, origine: 'etat', positionFile: 1, machine: null }, T0);
  assert.deepEqual(etat.details, ['Lors de la dernière vérification par Mimmo : 1 rendu devant le vôtre dans la file.']);
  assert.deepEqual(vueCarteSuivi(t, { ...INDICE_LANCE, origine: 'etat', positionFile: 0, machine: null }, T0).details,
    ['Lors de la dernière vérification par Mimmo : aucun rendu devant le vôtre dans la file.']);
});

test('vue en cours : progression et étape écrites par la machine ; silence > 15 min signalé', () => {
  const t = travail({ statut: 'en_cours', progression: 42, etape: 'Rendu de la vue 3/4 gauche', demarre_le: iso(T0), maj_le: iso(T0 + 60_000) });
  const v = vueCarteSuivi(t, INDICE_LANCE, T0 + 2 * 60_000);
  assert.equal(v.progression, 42);
  assert.equal(v.phrase, 'Rendu de la vue 3/4 gauche — 42 %');
  assert.equal(v.alerte, null);
  assert.match(vueCarteSuivi(t, INDICE_LANCE, T0 + 31 * 60_000).alerte ?? '', /Aucune progression reçue depuis 30 min/);
});

test('vue terminée / échec / annulé : le suivi s’arrête', () => {
  const fini = vueCarteSuivi(travail({ statut: 'termine', progression: 100, resultat: { image_path: 'u/j/a.jpg', images: [], avertissements: ['Ciel simplifié.'] }, elements_omis: [{ categorie: 'arbres' }] }), INDICE_LANCE, T0);
  assert.equal(fini.actif, false);
  assert.equal(fini.titre, 'Image photoréaliste — prête');
  assert.deepEqual(fini.avertissements, ['Ciel simplifié.']);
  assert.match(fini.omis ?? '', /arbres/);
  const echec = vueCarteSuivi(travail({ statut: 'echec', erreur: 'Blender a quitté' }), INDICE_LANCE, T0);
  assert.equal(echec.actif, false);
  assert.equal(echec.phrase, 'La préparation n’a pas abouti : Blender a quitté. Vous pouvez demander à Mimmo de relancer le rendu.');
  assert.equal(vueCarteSuivi(travail({ statut: 'echec' }), INDICE_LANCE, T0).phrase, 'La préparation n’a pas abouti. Vous pouvez demander à Mimmo de relancer le rendu.');
  assert.equal(vueCarteSuivi(travail({ statut: 'annule' }), INDICE_LANCE, T0).actif, false);
});

test('dureeLisible', () => {
  assert.equal(dureeLisible(20_000), '1 min');
  assert.equal(dureeLisible(12 * 60_000), '12 min');
  assert.equal(dureeLisible(3 * 3_600_000), '3 h');
  assert.equal(dureeLisible(3 * 86_400_000), '3 jours');
});

// ── Fichiers du résultat : mêmes chemins que studio_etat_rendu ─────────────────

function depotFactice(t: Record<string, unknown>): DepotStudio {
  const non = () => { throw new Error('non utilisé'); };
  return {
    conception: non, derniereVersion: non, enregistrerPreparation: non, preparation: non, typeRenduAutorise: non,
    statsFile: async () => null, travauxActifs: non, travailParDevis: non, jetonsDevis: non, insererTravail: non,
    travail: async () => t as unknown as TravailLu, positionFile: async () => 0,
    urlSigneeRendu: async (chemin: string) => `signee:${chemin}`,
  } as unknown as DepotStudio;
}

async function liensServeur(t: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await executerOutilStudio('studio_etat_rendu', {}, {
    userId: 'u1', depot: depotFactice(t), secret: null, requete: 'r', conversationId: 'c1', origine: 'https://mimmoza.example', maintenant: () => T0,
  });
  assert.equal(r?.status, 'ok');
  return ((r as { data: Record<string, unknown> }).data.liens ?? {}) as Record<string, unknown>;
}

function liensFront(t: Record<string, unknown>): Record<string, unknown> {
  const f = fichiersResultat(lireTravail(t));
  const images = f.filter(x => x.genre === 'image').map(x => `signee:${(x as { chemin: string }).chemin}`);
  const video = f.find(x => x.genre === 'video') as { chemin: string; affiche: string | null } | undefined;
  const visite = f.find(x => x.genre === 'visite') as { visiteId: string } | undefined;
  return {
    ...(video ? { video: `signee:${video.chemin}`, ...(video.affiche ? { affiche: `signee:${video.affiche}` } : {}) } : {}),
    ...(f.length && f.every(x => x.genre === 'image') ? { images } : {}),
    ...(visite ? { visite: `https://mimmoza.example/visite/${visite.visiteId}` } : {}),
  };
}

test('fichiersResultat = liens de studio_etat_rendu (image 3 vues, image seule, film + affiche, visite)', async () => {
  const cas = [
    ligne({ statut: 'termine', type: 'image', resultat: { image_path: 'u1/j/gauche.jpg', images: [
      { vue: 'trois_quarts_gauche', libelle: '3/4 gauche', jpeg_path: 'u1/j/gauche.jpg', png_path: 'u1/j/gauche.png' },
      { vue: 'trois_quarts_droite', libelle: '3/4 droite', jpeg_path: 'u1/j/droite.jpg', png_path: null },
      { vue: 'face', libelle: 'Face', jpeg_path: 'u1/j/face.jpg', png_path: null },
    ], avertissements: [] } }),
    ligne({ statut: 'termine', type: 'image', resultat: { image_path: 'u1/j/seule.jpg', avertissements: [] } }),
    ligne({ statut: 'termine', type: 'film', resultat: { video_path: 'u1/j/film.mp4', poster_path: 'u1/j/poster.jpg', avertissements: [] } }),
    ligne({ statut: 'termine', type: 'film', resultat: { video_path: 'u1/j/film.mp4', avertissements: [] } }),
    ligne({ statut: 'termine', type: 'visite360', resultat: { visite_id: 'Abc123_xyz', manifest_path: 'Abc123_xyz/manifest.json', avertissements: [] } }),
  ];
  for (const t of cas) assert.deepEqual(liensFront(t), await liensServeur(t), JSON.stringify(t.resultat));
  assert.equal(fichiersResultat(lireTravail(cas[0]))[0].genre === 'image' && (fichiersResultat(lireTravail(cas[0]))[0] as { libelle: string }).libelle, '3/4 gauche');
});

test('fichiersResultat : rien tant que le travail n’est pas terminé', () => {
  assert.deepEqual(fichiersResultat(travail({ statut: 'en_cours', resultat: { image_path: 'a.jpg' } })), []);
  assert.deepEqual(fichiersResultat(null), []);
});
