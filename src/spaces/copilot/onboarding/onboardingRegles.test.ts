import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type EtatOnboarding,
  actionsPourProfil,
  afficherChecklist,
  afficherEncart,
  etapesChecklist,
  normaliserProfil,
  rappelQuota,
} from './onboardingRegles.ts';

const NEUF: EtatOnboarding = {
  nbConversations: 0,
  analysesRapides: 0,
  exportPdf: false,
  moduleOuvert: false,
  encartFerme: false,
  checklistFermee: false,
  ancienneteJours: 0.1,
};

test('nouveau compte : encart et checklist affichés', () => {
  assert.equal(afficherEncart(NEUF), true);
  assert.equal(afficherChecklist(NEUF), true);
  assert.deepEqual(etapesChecklist(NEUF).map((e) => e.fait), [false, false, false]);
});

test('une conversation ou une analyse rapide masque l’encart', () => {
  assert.equal(afficherEncart({ ...NEUF, nbConversations: 1 }), false);
  assert.equal(afficherEncart({ ...NEUF, analysesRapides: 2 }), false);
});

test('encart fermé côté serveur : plus jamais affiché, même sans analyse', () => {
  assert.equal(afficherEncart({ ...NEUF, encartFerme: true }), false);
});

test('la checklist se coche à partir des données réelles', () => {
  const e = { ...NEUF, nbConversations: 3, exportPdf: true };
  assert.deepEqual(etapesChecklist(e).map((x) => [x.id, x.fait]), [
    ['analyse', true], ['export_pdf', true], ['module', false],
  ]);
  assert.equal(afficherChecklist(e), true);
});

test('la checklist disparaît une fois finie ou fermée', () => {
  const fini = { ...NEUF, nbConversations: 1, exportPdf: true, moduleOuvert: true };
  assert.equal(afficherChecklist(fini), false);
  assert.equal(afficherChecklist({ ...NEUF, checklistFermee: true }), false);
});

test('compte ancien déjà actif : pas de checklist imposée', () => {
  assert.equal(afficherChecklist({ ...NEUF, nbConversations: 40, ancienneteJours: 200 }), false);
  assert.equal(afficherChecklist({ ...NEUF, nbConversations: 2, ancienneteJours: 12 }), true);
});

test('actions selon le profil : trois, et chacune produit une vraie demande', () => {
  for (const p of [null, 'promoteur', 'marchand', 'particulier', 'autre'] as const) {
    const actions = actionsPourProfil(p);
    assert.equal(actions.length, 3);
    for (const a of actions) {
      const demande = a.demande('10 rue de la Gare, 33000 Bordeaux');
      assert.ok(demande.length > 20, a.id);
      if (a.champ) assert.match(demande, /10 rue de la Gare/);
    }
  }
  assert.deepEqual(actionsPourProfil(null).map((a) => a.titre), [
    'Analyser une adresse', 'Évaluer une opération (bilan)', 'Créer une maquette 3D',
  ]);
});

test('aucune action ne demande ni n’affiche de prix DVF', () => {
  for (const p of [null, 'marchand', 'particulier'] as const) {
    for (const a of actionsPourProfil(p)) assert.doesNotMatch(a.demande('x'), /DVF/i);
  }
});

test('profil déduit → profil de l’encart', () => {
  assert.equal(normaliserProfil('investisseur'), 'marchand');
  assert.equal(normaliserProfil('promoteur'), 'promoteur');
  assert.equal(normaliserProfil(null), null);
  assert.equal(normaliserProfil('inconnu'), null);
});

test('rappel des quotas lu dans grille.ts', () => {
  const d = rappelQuota('basique');
  assert.equal(d.nomFormule, 'Découverte');
  assert.ok(d.lignes.includes('3 analyses rapides par mois'));
  assert.ok(d.lignes.includes('10 messages à Mimmo par mois'));
  assert.match(d.apres, /10 jetons par analyse rapide/);
  const p = rappelQuota('pro');
  assert.ok(p.lignes.includes('300 analyses rapides par mois'));
  assert.ok(p.lignes.includes('800 jetons par mois'));
});
