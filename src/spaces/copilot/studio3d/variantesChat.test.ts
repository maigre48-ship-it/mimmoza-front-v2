// src/spaces/copilot/studio3d/variantesChat.test.ts
// LOT G7 (18/11/2026) — carte « Variantes » : historique relu dans la dernière sortie du parcours, image rattachée à la
// variante affichée au moment du lancement, état des vignettes (garde-fou X9 : jamais d'image sans vraie photo).
import assert from 'node:assert/strict';
import test from 'node:test';
import { etatVignette, titreVariante, variantesDeConversation } from './variantesChat.ts';
import type { TravailStudio } from '../../../lib/studio/travauxLogique.ts';

const E = (n: number) => 'e'.repeat(63) + String(n);
const V = (n: number, verdict = 'placee') => ({ n, cree_le: `2026-11-18T08:0${n}:00.000Z`, changements: n > 1 ? [`changement ${n}`] : [], resume: `résumé ${n}`, verdict, empreinte_projet: E(n) });
const ext = (id: string, n: number, variantes: unknown[]) => ({ id, name: 'extension_maison', status: 'success', output: { status: 'ok', data: { etat: { v: 1, variante: n }, variantes } } });
const rendu = (id: string, job: string) => ({ id, name: 'studio_lancer_rendu', status: 'success', output: { status: 'ok', data: { job_id: job, lance: true, type: 'image', statut: 'en_attente' } } });
const J1 = '11111111-1111-4111-8111-111111111111', J2 = '22222222-2222-4222-8222-222222222222', J3 = '33333333-3333-4333-8333-333333333333';

test('G7-F1 : variantes de la conversation → historique de la dernière sortie, image rattachée à la variante affichée', () => {
  const messages = [
    { toolCalls: [ext('a1', 1, [V(1)])] },
    { toolCalls: [rendu('r1', J1)] },
    { toolCalls: [ext('a2', 2, [V(1), V(2)])] },
    { toolCalls: [rendu('r2', J2)] },
    { toolCalls: [{ id: 'r2b', name: 'studio_etat_rendu', status: 'success', output: { status: 'ok', data: { job_id: J3, type: 'image', statut: 'termine' } } }] },
    { toolCalls: [ext('a3', 3, [V(1), V(2), V(3, 'refusee')])] },
  ];
  const r = variantesDeConversation(messages);
  assert.equal(r.appelId, 'a3', 'la carte est portée par la dernière sortie du parcours');
  assert.deepEqual(r.variantes.map((v) => [v.n, v.jobId, v.verdict]), [[1, J1, 'placee'], [2, J2, 'placee'], [3, null, 'refusee']]);
  assert.equal(titreVariante(r.variantes[2]!), 'V3 · non placée');
  // Un devis (rien de lancé) ne rattache aucune image ; sortie illisible ignorée.
  const devis = { id: 'd', name: 'studio_lancer_rendu', status: 'success', output: { status: 'confirmation_requise', data: { job_id: J1 } } };
  const r2 = variantesDeConversation([{ toolCalls: [ext('a1', 1, [V(1), V(2)]), devis, { id: 'x', name: 'extension_maison', status: 'success', output: 'illisible' }] }]);
  assert.deepEqual(r2.variantes.map((v) => v.jobId), [null, null]);
  assert.deepEqual(variantesDeConversation([]), { variantes: [], appelId: null });
});

test('G7-F2 : état des vignettes — en préparation, livrable, à valider, photo nécessaire (jamais d’image sans vraie photo)', () => {
  const base = { id: J1, conversation_id: 'c', type: 'image', progression: 100, etape: null, options: {}, elements_omis: [], erreur: null, cree_le: '', maj_le: '', demarre_le: null, termine_le: null, projet_extension: { nature: 'extension' } } as unknown as TravailStudio;
  assert.equal(etatVignette(null, null).etat, 'aucune');
  assert.equal(etatVignette(J1, null).etat, 'chargement');
  assert.equal(etatVignette(J1, { ...base, statut: 'en_cours', resultat: null }).etat, 'en_cours');
  assert.equal(etatVignette(J1, { ...base, statut: 'echec', resultat: null }).etat, 'echec');
  const surPhoto = { images: [{ vue: 'face', libelle: 'Face', jpeg_path: 'u/j/face.jpg' }], photomontage: { statut: 'livre', verdict: 'cale', source_photo: { type: 'client' } } };
  const sansPhoto = { images: [{ vue: 'face', libelle: 'Face', jpeg_path: 'u/j/face.jpg' }] };
  const t = (resultat: unknown, rx: unknown = { livrable: true, statut_x7: 'livrable' }) => ({ ...base, statut: 'termine', resultat, resultat_extension: rx }) as unknown as TravailStudio;
  assert.equal(etatVignette(J1, t(sansPhoto)).etat, 'photo_requise');
  assert.deepEqual(etatVignette(J1, t(surPhoto)), { etat: 'livrable', libelle: 'Image livrable' });
  assert.equal(etatVignette(J1, t(surPhoto, { livrable: false, statut_x7: 'a_valider' })).etat, 'a_valider');
});
