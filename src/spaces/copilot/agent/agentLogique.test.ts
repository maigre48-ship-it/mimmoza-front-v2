import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bornerBudget, consommeCeMois, devisAAfficher, dureeLisible, formatEuros, formatJetons,
  lienMailto, lienSur, lireAction, lireBriefing, lireDevis, lireIssueEnvoi, lireMission,
  lirePropositionDevis, lireRapport, messageErreurAgent, devisExpire, MESSAGE_DEVIS_EXPIRE, agentNonInstalle, missionActive,
  peutAnnuler, peutRepondre, progression, resumerDevis, texteACopier, tonVerdict, trierMemoire,
} from './agentLogique.ts';

// Les nombres français utilisent des espaces insécables : on les normalise.
const n = (s: string) => s.replace(/[  ]/g, ' ');

test('lireDevis : borne le minimum et refuse un devis sans maximum', () => {
  assert.deepEqual(lireDevis({ jetons_min: 500, jetons_max: 1200, etapes_max: 20, tier: 'sonnet' }),
    { jetons_min: 500, jetons_max: 1200, etapes_max: 20, tier: 'sonnet' });
  assert.equal(lireDevis({ jetons_min: 10 }), null);
  assert.equal(lireDevis({ jetons_min: 2000, jetons_max: 1000 })?.jetons_min, 1000);
  assert.equal(lireDevis({ jetons_max: '800' })?.jetons_min, 800);
});

test('lirePropositionDevis : événement à plat, mission imbriquée, data, JSON texte', () => {
  const plat = lirePropositionDevis({ type: 'mission_devis', id: 'm1', objectif: 'Prospecter Montreuil', devis: { jetons_min: 1, jetons_max: 2 } });
  assert.equal(plat?.missionId, 'm1');
  assert.equal(plat?.objectif, 'Prospecter Montreuil');
  const imbrique = lirePropositionDevis({ type: 'mission_devis', mission: { id: 'm2', type: 'faisabilite', devis: { jetons_max: 5 } } });
  assert.equal(imbrique?.missionId, 'm2');
  assert.equal(imbrique?.type, 'faisabilite');
  const data = lirePropositionDevis({ status: 'ok', data: { mission_id: 'm3', devis: { jetons_max: 9 } } });
  assert.equal(data?.missionId, 'm3');
  const texte = lirePropositionDevis(JSON.stringify({ mission_id: 'm4', devis: { jetons_max: 3 } }));
  assert.equal(texte?.missionId, 'm4');
  assert.equal(lirePropositionDevis('pas du json'), null);
  assert.equal(lirePropositionDevis({ rien: true }), null);
});

test('devisAAfficher : une seule carte par mission (outil + événement)', () => {
  const r = devisAAfficher([
    { id: 'a', name: 'get_plu', status: 'success', output: {} },
    { id: 'b', name: 'proposer_mission', status: 'success', output: { mission_id: 'm1', devis: { jetons_max: 10 } } },
    { id: 'c', name: 'mission_devis', status: 'success', output: { id: 'm1', devis: { jetons_max: 10 } } },
  ]);
  assert.equal(r.size, 1);
  assert.equal(r.get('b')?.etat, 'carte');
  assert.equal(r.has('c'), false);
});

test('devisAAfficher : préparation, erreur, et appel sans id masqué si une carte existe', () => {
  assert.equal(devisAAfficher([{ id: 'x', name: 'proposer_mission', status: 'running' }]).get('x')?.etat, 'preparation');
  assert.equal(devisAAfficher([{ id: 'x', name: 'proposer_mission', status: 'error', output: 'boom' }]).get('x')?.etat, 'erreur');
  const r = devisAAfficher([
    { id: 'x', name: 'proposer_mission', status: 'success', output: { ok: true } },
    { id: 'y', name: 'mission_devis', status: 'success', output: { id: 'm9', devis: { jetons_max: 4 } } },
  ]);
  assert.deepEqual([...r.keys()], ['y']);
});

test('formatJetons / formatEuros : valeur du jeton fournie par l’application', () => {
  assert.equal(n(formatJetons(1)), '1 jeton');
  assert.equal(n(formatJetons(12000)), '12 000 jetons');
  assert.equal(n(formatEuros(1200, 0.1)), '120 € HT');
  assert.equal(n(formatEuros(15, 0.1)), '1,50 € HT');
});

test('resumerDevis : fourchette, réserve et solde insuffisant', () => {
  const r = resumerDevis({ jetons_min: 400, jetons_max: 1000 }, 600, 0.1);
  assert.equal(n(r.fourchette), 'entre 400 et 1 000 jetons');
  assert.equal(n(r.fourchetteEuros), '40 € à 100 € HT');
  assert.equal(r.soldeSuffisant, false);
  assert.equal(r.manque, 400);
  assert.equal(resumerDevis({ jetons_min: 10, jetons_max: 10 }, null, 0.1).soldeSuffisant, null);
  assert.equal(n(resumerDevis({ jetons_min: 10, jetons_max: 10 }, 50, 0.1).fourchette), '10 jetons');
});

test('dureeLisible', () => {
  assert.equal(dureeLisible(undefined), null);
  assert.equal(dureeLisible(25), 'environ 25 min');
  assert.equal(dureeLisible(90), 'environ 1 h 30');
  assert.equal(dureeLisible(120), 'environ 2 h');
});

test('progression : bornée, 100 % à la fin, jetons plafonnés à la réserve', () => {
  const p = progression({ etapes_faites: 10, etapes_max: 40, jetons_consommes: 300, jetons_reserves: 1200, statut: 'en_cours' });
  assert.equal(p.pctEtapes, 25);
  assert.equal(p.pctJetons, 25);
  assert.equal(p.restants, 900);
  assert.equal(progression({ etapes_faites: 12, etapes_max: 40, jetons_consommes: 0, jetons_reserves: 0, statut: 'terminee' }).pctEtapes, 100);
  const trop = progression({ etapes_faites: 99, etapes_max: 40, jetons_consommes: 5000, jetons_reserves: 1000, statut: 'budget_atteint' });
  assert.equal(trop.etapes, 40);
  assert.equal(trop.consommes, 1000);
  assert.equal(trop.pctJetons, 100);
});

test('statuts : actives, annulables, réponse attendue', () => {
  assert.equal(missionActive('attente_utilisateur'), true);
  assert.equal(missionActive('terminee'), false);
  assert.equal(peutAnnuler('devis'), true);
  assert.equal(peutAnnuler('annulee'), false);
  assert.equal(peutRepondre({ statut: 'attente_utilisateur', question_en_attente: 'Quel budget ?' }), true);
  assert.equal(peutRepondre({ statut: 'attente_utilisateur', question_en_attente: null }), false);
});

test('lireMission et lireRapport : tolérants aux champs manquants', () => {
  const m = lireMission({ id: 'm1', statut: 'terminee', jetons_reserves: '1000', rapport: {
    titre: 'Prospection Montreuil', synthese: '3 terrains',
    terrains: [{ idu: '93048000AB0012', surface_m2: 1800, verdict: 'Retenu', points_forts: ['Zone UA'], sources: ['gpu'] }, 'n’importe quoi'],
    limites: ['PLU partiel'], actions_proposees: ['a1'],
  } });
  assert.equal(m?.jetons_reserves, 1000);
  assert.equal(m?.etapes_max, 40);
  assert.equal(m?.rapport?.terrains.length, 1);
  assert.deepEqual(m?.rapport?.terrains[0].points_bloquants, []);
  assert.equal(m?.rapport?.terrains[0].zonage, null);
  assert.equal(lireRapport({}), null);
  assert.equal(lireMission({ statut: 'x' }), null);
});

test('tonVerdict', () => {
  assert.equal(tonVerdict('Retenu, prioritaire'), 'bon');
  assert.equal(tonVerdict('À creuser'), 'moyen');
  assert.equal(tonVerdict('Écarté : zone N'), 'mauvais');
  assert.equal(tonVerdict('Constructibilité indéterminable'), 'moyen');
  assert.equal(tonVerdict(undefined), 'neutre');
});

test('lireIssueEnvoi : courrier prêt, boîte non connectée (parcours normal), refus lisible', () => {
  assert.deepEqual(lireIssueEnvoi({ ok: true, canal: 'courrier', url: 'https://x.supabase.co/storage/v1/sign/a.pdf?token=1' }),
    { genre: 'envoye', lienPdf: 'https://x.supabase.co/storage/v1/sign/a.pdf?token=1' });
  assert.deepEqual(lireIssueEnvoi({ ok: true, deja_envoye: true, canal: 'email' }), { genre: 'envoye', lienPdf: null });
  assert.deepEqual(lireIssueEnvoi({ ok: false, raison: 'boite_non_connectee', repli: { mailto: 'mailto:a@b.fr?subject=x' } }),
    { genre: 'boite_non_connectee', mailto: 'mailto:a@b.fr?subject=x' });
  assert.deepEqual(lireIssueEnvoi({ ok: false, raison: 'boite_non_connectee', repli: { mailto: 'javascript:alert(1)' } }),
    { genre: 'boite_non_connectee', mailto: null });
  const refus = lireIssueEnvoi({ ok: false, raison: 'profil_incomplet' });
  assert.equal(refus.genre, 'echec');
  assert.match((refus as { message: string }).message, /profil/);
  assert.equal(lireIssueEnvoi({ ok: true, url: 'javascript:alert(1)' }).genre, 'envoye');
  assert.equal((lireIssueEnvoi({ ok: true, url: 'javascript:alert(1)' }) as { lienPdf: string | null }).lienPdf, null);
});

test('lienMailto / texteACopier', () => {
  const a = lireAction({ id: 'a1', canal: 'email', destinataire: { nom: 'Mairie', qualite: 'mairie', email: 'urba@ville.fr' }, objet: 'PLU & projet', corps: 'Bonjour,\nMerci.' })!;
  const l = lienMailto(a);
  assert.ok(l.startsWith('mailto:urba%40ville.fr?subject=PLU%20%26%20projet&body='));
  assert.ok(l.includes('Bonjour%2C%0AMerci.'));
  assert.equal(texteACopier(a), 'À : urba@ville.fr\nObjet : PLU & projet\n\nBonjour,\nMerci.');
  const long = lienMailto({ ...a, corps: 'x'.repeat(5000) });
  assert.ok(long.length < 2200);
});

test('lienSur et lireBriefing : seuls les liens internes ou http(s) passent', () => {
  assert.equal(lienSur('/promoteur/foncier'), '/promoteur/foncier');
  assert.equal(lienSur('//evil.com'), null);
  assert.equal(lienSur('javascript:alert(1)'), null);
  assert.equal(lienSur('https://www.geoportail-urbanisme.gouv.fr'), 'https://www.geoportail-urbanisme.gouv.fr');
  const b = lireBriefing({ id: 'b1', elements: [{ genre: 'permis', titre: 'PC accordé rue X', lien: 'javascript:x' }, { detail: 'sans titre' }] });
  assert.equal(b?.elements.length, 1);
  assert.equal(b?.elements[0].lien, undefined);
  assert.equal(b?.titre, 'Pendant votre absence');
});

test('messageErreurAgent : phrases simples, jamais de jargon SQL', () => {
  assert.match(messageErreurAgent({ code: 'P0001', hint: 'agent_solde_insuffisant', message: 'Solde insuffisant : il faut 1200 jetons disponibles pour lancer cette mission.' }), /recharger/);
  assert.equal(messageErreurAgent({ code: 'P0001', hint: 'agent_missions_plafond', message: 'Vous avez déjà 3 missions en cours.' }), 'Vous avez déjà 3 missions en cours.');
  assert.equal(messageErreurAgent({ message: 'MISSION_INTROUVABLE', code: 'P0002' }), 'Cette mission est introuvable.');
  assert.match(messageErreurAgent({ code: '42P01', message: 'relation "public.agent_missions" does not exist' }), /pas encore activée/);
  assert.equal(agentNonInstalle({ code: 'PGRST205' }), true);
  assert.match(messageErreurAgent({ message: 'new row violates row-level security policy' }), /n'a pas abouti/);
});

test('consommeCeMois et bornerBudget', () => {
  const now = new Date('2026-10-30T10:00:00Z');
  assert.equal(consommeCeMois(1500, '2026-10-01', now), 1500);
  assert.equal(consommeCeMois(1500, '2026-09-01', now), 0);
  assert.equal(consommeCeMois(1500, null, now), 0);
  assert.equal(bornerBudget(25000), 20000);
  assert.equal(bornerBudget(-3), 0);
  assert.equal(bornerBudget(Number.NaN), 0);
});

test('trierMemoire : épinglés d’abord puis plus récents', () => {
  const base = { projet_id: null, mission_id: null, genre: 'fait', cle: null, contenu: '', source: null, confiance: null, cree_le: null };
  const r = trierMemoire([
    { ...base, id: 'a', epingle: false, maj_le: '2026-10-29T10:00:00Z' },
    { ...base, id: 'b', epingle: true, maj_le: '2026-10-01T10:00:00Z' },
    { ...base, id: 'c', epingle: false, maj_le: '2026-10-30T10:00:00Z' },
  ]);
  assert.deepEqual(r.map((x) => x.id), ['b', 'c', 'a']);
});

test('devis expiré : dates lues, expiration détectée, erreur serveur traduite', () => {
  const d = lireDevis({ jetons_min: 100, jetons_max: 200, emis_le: '2026-10-29T08:00:00Z', expire_le: '2026-10-30T08:00:00Z' });
  assert.equal(d?.expire_le, '2026-10-30T08:00:00Z');
  assert.equal(devisExpire(d, Date.parse('2026-10-30T09:00:00Z')), true);
  assert.equal(devisExpire(d, Date.parse('2026-10-30T07:59:00Z')), false);
  assert.equal(devisExpire({}, Date.now()), false);
  assert.equal(devisExpire(null), false);
  assert.equal(messageErreurAgent({ code: '22023', hint: 'agent_devis_expire', message: 'Devis expiré : demandez-en un nouveau.' }), MESSAGE_DEVIS_EXPIRE);
  assert.equal(MESSAGE_DEVIS_EXPIRE, 'Ce devis a expiré (plus de 24 h). Demandez-en un nouveau.');
});
