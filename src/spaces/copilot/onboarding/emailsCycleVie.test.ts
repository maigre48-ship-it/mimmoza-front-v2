// Tests des règles et gabarits des e-mails de cycle de vie.
// La logique vit dans supabase/functions/_shared/emails (Deno) ; elle est pure
// et sans import réseau, donc testable ici avec node --test (npm test).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type ProfilEnvoi,
  ANALYSES_INCLUSES,
  JETONS_PAR_ANALYSE,
  NOM_FORMULE_EMAIL,
  candidats,
  formuleActive,
  jourParis,
  selectionner,
} from '../../../../supabase/functions/_shared/emails/regles.ts';
import { echapper, rendreEmail } from '../../../../supabase/functions/_shared/emails/gabarits.ts';
import { lienDesinscription, signer, verifier } from '../../../../supabase/functions/_shared/emails/desinscription.ts';
import { ANALYSES_RAPIDES_INCLUSES_PAR_FORMULE, NOM_FORMULE } from '../../../lib/billing/grille.ts';
import { ACTION_COSTS } from '../../../lib/billing/actionCosts.ts';
import { FORMULES_VENDUES } from '../../../lib/billing/planAccess.ts';

const MAINTENANT = new Date('2026-10-22T09:00:00Z');
const il = (jours: number) => new Date(MAINTENANT.getTime() - jours * 86_400_000).toISOString();

function profil(p: Partial<ProfilEnvoi> = {}): ProfilEnvoi {
  return {
    userId: '00000000-0000-4000-8000-000000000001',
    email: 'test@example.com',
    prenom: 'Camille',
    inscritLe: il(0.2),
    confirmeLe: il(0.1),
    formule: 'basique',
    analysesMois: 0,
    analysesTotal: 0,
    soldeJetons: 100,
    depensesJetons30j: 0,
    nbConversations: 0,
    premiereConversation: null,
    preferences: { conseils: true, alertes_usage: true },
    envois: [],
    ...p,
  };
}
const types = (p: ProfilEnvoi) => selectionner(p, MAINTENANT).map((d) => d.type);

test('constantes recopiées identiques à la grille tarifaire', () => {
  // Comparaison limitée aux formules vendues. L'ancien code proplus (formule
  // « Équipe », retirée le 23/10/2026) est un alias de Pro côté front ; la copie
  // serveur (supabase/functions/_shared/emails/regles.ts) le traite encore à
  // part et sera alignée avec la mise à jour des fonctions serveur.
  for (const code of FORMULES_VENDUES) {
    assert.equal(ANALYSES_INCLUSES[code], ANALYSES_RAPIDES_INCLUSES_PAR_FORMULE[code], code);
    assert.equal(NOM_FORMULE_EMAIL[code], NOM_FORMULE[code], code);
  }
  assert.equal(JETONS_PAR_ANALYSE, ACTION_COSTS.analyse_rapide);
});

test('formule active : même logique que formule_active() en SQL', () => {
  assert.equal(formuleActive('pro', 'active'), 'pro');
  assert.equal(formuleActive('pro', 'canceled'), 'basique');
  assert.equal(formuleActive('advanced', 'trialing'), 'avance');
  assert.equal(formuleActive(null, null), 'basique');
});

test('bienvenue : après confirmation, une seule fois, comptes récents seulement', () => {
  assert.deepEqual(types(profil()), ['bienvenue']);
  assert.deepEqual(types(profil({ confirmeLe: null })), []);
  assert.deepEqual(types(profil({ envois: [{ type: 'bienvenue', cle: 'unique', envoyeLe: il(0.05) }] })), []);
  // Compte confirmé il y a 2 mois : pas de bienvenue au lancement de la fonction.
  assert.deepEqual(types(profil({ inscritLe: il(60), confirmeLe: il(60) })), []);
});

test('première analyse prête : conversation récente, une fois', () => {
  const p = profil({
    envois: [{ type: 'bienvenue', cle: 'unique', envoyeLe: il(1) }],
    nbConversations: 1,
    premiereConversation: { id: 'c1', creeLe: il(0.02) },
  });
  assert.deepEqual(types(p), ['premiere_analyse']);
  assert.deepEqual(types({ ...p, premiereConversation: { id: 'c1', creeLe: il(5) } }), []);
});

test('rappel : aucune analyse 3 jours après l’inscription, pas avant, pas après 10 jours', () => {
  const base = { envois: [{ type: 'bienvenue' as const, cle: 'unique', envoyeLe: il(3) }] };
  assert.deepEqual(types(profil({ ...base, inscritLe: il(2), confirmeLe: il(2) })), []);
  assert.deepEqual(types(profil({ ...base, inscritLe: il(3.5), confirmeLe: il(3.5) })), ['rappel_sans_analyse']);
  assert.deepEqual(types(profil({ ...base, inscritLe: il(11), confirmeLe: il(11) })), []);
  assert.deepEqual(types(profil({ ...base, inscritLe: il(4), confirmeLe: il(4), analysesTotal: 1 })), []);
  assert.deepEqual(types(profil({ ...base, inscritLe: il(4), confirmeLe: il(4), nbConversations: 1 })), []);
});

test('quota : 80 % puis 100 %, une fois par mois, 100 % prioritaire', () => {
  const vieux = { inscritLe: il(90), confirmeLe: il(90) };
  assert.deepEqual(types(profil({ ...vieux, formule: 'avance', analysesMois: 79 })), []);
  assert.deepEqual(types(profil({ ...vieux, formule: 'avance', analysesMois: 80 })), ['quota_80']);
  assert.deepEqual(types(profil({ ...vieux, formule: 'avance', analysesMois: 100 })), ['quota_100']);
  // Découverte (3) : 2/3 = 67 % → rien ; 3/3 → 100 %.
  assert.deepEqual(types(profil({ ...vieux, analysesMois: 2 })), []);
  assert.deepEqual(types(profil({ ...vieux, analysesMois: 3 })), ['quota_100']);
  // Déjà envoyé ce mois-ci → rien ; mois suivant → de nouveau.
  const envoye = profil({ ...vieux, analysesMois: 3, envois: [{ type: 'quota_100', cle: '2026-10', envoyeLe: il(3) }] });
  assert.deepEqual(types(envoye), []);
  assert.deepEqual(selectionner(envoye, new Date('2026-11-03T09:00:00Z')).map((d) => d.cle), ['2026-11']);
});

test('solde bas : seulement pour un compte qui dépense des jetons', () => {
  const vieux = { inscritLe: il(90), confirmeLe: il(90) };
  assert.deepEqual(types(profil({ ...vieux, soldeJetons: 12, depensesJetons30j: 0 })), []);
  assert.deepEqual(types(profil({ ...vieux, soldeJetons: 12, depensesJetons30j: 4 })), ['solde_bas']);
  assert.deepEqual(types(profil({ ...vieux, soldeJetons: 30, depensesJetons30j: 4 })), []);
  assert.deepEqual(types(profil({ ...vieux, soldeJetons: null, depensesJetons30j: 4 })), []);
});

test('désinscription respectée pour les non transactionnels, jamais pour le compte', () => {
  const vieux = { inscritLe: il(90), confirmeLe: il(90) };
  const off = { conseils: false, alertes_usage: false };
  assert.deepEqual(types(profil({ ...vieux, formule: 'avance', analysesMois: 85, preferences: off })), []);
  assert.deepEqual(types(profil({ ...vieux, analysesMois: 3, preferences: off })), ['quota_100']);
  assert.deepEqual(types(profil({ preferences: off })), ['bienvenue']);
});

test('au plus un e-mail non transactionnel par jour (heure de Paris)', () => {
  const vieux = { inscritLe: il(90), confirmeLe: il(90) };
  const deux = profil({ ...vieux, formule: 'avance', analysesMois: 85, soldeJetons: 5, depensesJetons30j: 3 });
  assert.equal(candidats(deux, MAINTENANT).length, 2);
  assert.deepEqual(types(deux), ['quota_80']); // priorité au quota
  // Un non transactionnel déjà parti aujourd'hui → plus rien de non transactionnel.
  const dejaAujourdhui = { ...deux, envois: [{ type: 'quota_80' as const, cle: '2026-10', envoyeLe: il(0.1) }] };
  assert.deepEqual(types(dejaAujourdhui), []);
  // Le lendemain, le solde bas peut partir.
  assert.deepEqual(selectionner(dejaAujourdhui, new Date('2026-10-23T09:00:00Z')).map((d) => d.type), ['solde_bas']);
  // Un transactionnel passe même si un non transactionnel est parti aujourd'hui.
  assert.deepEqual(types({ ...dejaAujourdhui, analysesMois: 100 }), ['quota_100']);
});

test('jour de Paris : minuit local, pas UTC', () => {
  assert.equal(jourParis(new Date('2026-10-22T22:30:00Z')), '2026-10-23');
  assert.equal(jourParis(new Date('2026-01-15T23:30:00Z')), '2026-01-16');
});

test('pas d’adresse e-mail : aucun envoi', () => {
  assert.deepEqual(types(profil({ email: null })), []);
});

// ── Gabarits ─────────────────────────────────────────────────────────────────

const DONNEES = {
  appUrl: 'https://mimmoza.vercel.app/',
  prenom: 'Camille',
  formule: 'avance' as const,
  analysesMois: 82,
  soldeJetons: 140,
  conversationId: 'abc-123',
  lienDesinscription: 'https://exemple.test/desinscription?t=1',
  maintenant: MAINTENANT,
};

test('chaque gabarit : sujet, HTML en tables avec styles en ligne, version texte', () => {
  for (const type of ['bienvenue', 'premiere_analyse', 'rappel_sans_analyse', 'quota_80', 'quota_100', 'solde_bas'] as const) {
    const r = rendreEmail(type, DONNEES);
    assert.ok(r.sujet.length > 10 && r.sujet.length < 90, `${type} : sujet`);
    assert.match(r.html, /<html lang="fr"/);
    assert.match(r.html, /role="presentation"/);
    assert.doesNotMatch(r.html, /<style|class=/, `${type} : aucun CSS hors ligne`);
    assert.match(r.html, /#5b4bd6/i);
    assert.match(r.html, /alt="Mimmoza"/);
    assert.ok(r.texte.includes('Mimmoza'));
    assert.doesNotMatch(r.html, /undefined|NaN|null/);
    assert.doesNotMatch(r.texte, /undefined|NaN|null/);
    assert.doesNotMatch(r.html, /DVF|€\/m²/);
  }
});

test('lien de désinscription : présent et obligatoire pour les non transactionnels', () => {
  const r = rendreEmail('rappel_sans_analyse', DONNEES);
  assert.ok(r.html.includes('https://exemple.test/desinscription?t=1'));
  assert.ok(r.texte.includes('https://exemple.test/desinscription?t=1'));
  assert.throws(() => rendreEmail('solde_bas', { ...DONNEES, lienDesinscription: null }));
  const t = rendreEmail('bienvenue', { ...DONNEES, lienDesinscription: null });
  assert.match(t.texte, /ne peut pas être désactivé/);
});

test('contenus : chiffres réels et suite expliquée (10 jetons par analyse)', () => {
  const q80 = rendreEmail('quota_80', DONNEES);
  assert.match(q80.sujet, /82 de vos 100 analyses/);
  assert.match(q80.texte, /10 jetons/);
  assert.match(q80.texte, /1er\snovembre/);
  const q100 = rendreEmail('quota_100', DONNEES);
  assert.match(q100.texte, /140 jetons/);
  const prem = rendreEmail('premiere_analyse', DONNEES);
  assert.ok(prem.html.includes('https://mimmoza.vercel.app/mimmozia?conversation=abc-123'));
  const bienvenue = rendreEmail('bienvenue', { ...DONNEES, formule: 'basique' });
  assert.match(bienvenue.texte, /3 analyses rapides par mois et 10 messages/);
  assert.ok(bienvenue.html.includes('https://mimmoza.vercel.app/aide'));
});

test('le prénom est échappé', () => {
  const r = rendreEmail('bienvenue', { ...DONNEES, prenom: '<script>x</script>' });
  assert.doesNotMatch(r.html, /<script>/);
  assert.equal(echapper('a&b"<'), 'a&amp;b&quot;&lt;');
});

// ── Lien de désinscription signé ─────────────────────────────────────────────

test('jeton de désinscription : signé, vérifié, infalsifiable', async () => {
  const secret = 'un-secret-de-test-assez-long';
  const u = '00000000-0000-4000-8000-000000000001';
  const t = await signer(secret, u, 'conseils');
  assert.equal(await verifier(secret, u, 'conseils', t), true);
  assert.equal(await verifier(secret, u, 'alertes_usage', t), false);
  assert.equal(await verifier('autre-secret-tout-aussi-long', u, 'conseils', t), false);
  assert.equal(await verifier(secret, '00000000-0000-4000-8000-000000000002', 'conseils', t), false);
  assert.equal(await verifier(secret, u, 'compte', t), false);
  const lien = await lienDesinscription('https://x.supabase.co/functions/v1/emails-cycle-vie', secret, u, 'conseils');
  assert.match(lien, /action=desinscription&u=.+&c=conseils&t=/);
  await assert.rejects(() => signer('court', u, 'conseils'));
});
