// LOT G4 (17/11/2026) — suivi d'un rendu d'extension : l'outil dit au modèle si les PLANS sont prêts (sans liens ni
// cotes : la carte du chat les propose), ou pourquoi ils ne le sont pas (aucune promesse de PDF).
// deno test --no-lock --no-check -A --node-modules-dir=none supabase/functions/copilot-chat/agent/extension-g4.test.ts
import * as na from 'node:assert/strict';
import { executerOutilStudio, type DepotStudio, type EnvStudio } from './studio.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const CONV = 'conv-extension-g4';
const EMP = '108bd93607064b3a29192a3c99c9f930d7e4dd1147ce8c0ea854c3cf1b8a6816';
const BASE = `${USER}/22222222-2222-4222-8222-222222222222`;

function depot(resultat: Record<string, unknown>): DepotStudio {
  const t = {
    id: '22222222-2222-4222-8222-222222222222', user_id: USER, conversation_id: CONV, type: 'image', statut: 'termine', progression: 100, etape: 'Terminé',
    elements_omis: [], erreur: null, cree_le: '2026-11-17T14:33:17Z', demarre_le: '2026-11-17T14:33:39Z', termine_le: '2026-11-17T14:34:46Z', fiche: {}, options: {}, resultat,
  };
  return {
    travail: async () => t,
    urlSigneeRendu: async (c: string) => `https://stockage.test/${c}?token=x`,
    positionFile: async () => 0,
    statsFile: async () => ({}),
  } as unknown as DepotStudio;
}
const env = (d: DepotStudio): EnvStudio => ({ userId: USER, depot: d, secret: 'secret-de-test', requete: 'G4', conversationId: CONV, origine: 'https://mimmoza.vercel.app' });
const plans = (x: Record<string, unknown> = {}) => ({
  statut: 'envoye', empreinte_scene: EMP, pdf_path: `${BASE}/plans-extension.pdf`, dxf_path: `${BASE}/plans-extension-dxf.zip`, apercu_path: `${BASE}/plans-extension-apercu.png`,
  planches: [{ numero: 'PL-01', titre: 'Plan de masse', echelle: '1/200', format: 'A3 paysage' }], statuts: [], jetons: 0, ...x,
});

Deno.test('G4-1 : image demandant une photo (X9) mais plans prêts → photo demandée ET plans annoncés (sans liens)', async () => {
  const r = await executerOutilStudio('studio_etat_rendu', {}, env(depot({
    image_path: null, images: [], photo_requise: { code: 'aucune_photo', texte: 'x', atelier: false },
    extension: { ok: true, livrable: false, empreinte_scene: EMP, plans: plans() },
  })));
  na.equal(r?.status, 'ok');
  na.equal((r!.data!.photo_requise as Record<string, unknown>).code, 'aucune_photo');
  na.deepEqual(r!.data!.plans, { disponibles: true, modele: EMP.slice(0, 12), planches: ['PL-01 Plan de masse — 1/200'], jetons: 0 });
  na.match(r!.message!, /plans de l’extension .* sont prêts/);
  na.doesNotMatch(r!.message!, /https?:\/\/|plans-extension\.pdf/);
});

Deno.test('G4-2 : plans d’un autre modèle, ou non envoyés → indisponibles, aucune promesse de PDF', async () => {
  const autre = await executerOutilStudio('studio_etat_rendu', {}, env(depot({
    image_path: 'u/j/photo-rue.jpg', images: [{ vue: 'photo_rue', libelle: 'Photo de rue', jpeg_path: 'u/j/photo-rue.jpg' }],
    photomontage: { tente: true, statut: 'livre', source_photo: { type: 'panoramax' } },
    extension: { ok: true, livrable: true, empreinte_scene: 'f'.repeat(64), plans: plans() },
  })));
  na.equal((autre!.data!.plans as Record<string, unknown>).disponibles, false);
  na.match(autre!.message!, /ne promets aucun plan/);
  const nonEnvoye = await executerOutilStudio('studio_etat_rendu', {}, env(depot({
    image_path: null, images: [], photo_requise: { code: 'aucune_photo', texte: 'x', atelier: false },
    extension: { ok: true, livrable: false, empreinte_scene: EMP, plans: plans({ statut: 'non_envoye', pdf_path: null }) },
  })));
  na.equal((nonEnvoye!.data!.plans as Record<string, unknown>).disponibles, false);
});

Deno.test('G4-3 : rendu sans bloc de plans (machine antérieure, projet neuf) → rien n’est dit des plans', async () => {
  const r = await executerOutilStudio('studio_etat_rendu', {}, env(depot({
    image_path: 'u/j/image-face.jpg', images: [{ vue: 'face', libelle: 'Face', jpeg_path: 'u/j/image-face.jpg' }],
  })));
  na.equal('plans' in r!.data!, false);
  na.doesNotMatch(r!.message!, /plans de l’extension/);
});
