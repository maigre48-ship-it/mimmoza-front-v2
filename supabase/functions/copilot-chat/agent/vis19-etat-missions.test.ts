// deno test --no-lock --no-check -A vis19-etat-missions.test.ts
// VIS-19 (20/11/2026) — coût par message : bloc « ÉTAT RÉEL DES MISSIONS » seulement quand il sert ; parcours relu
// sans les 60 derniers messages complets.
import * as na from 'node:assert/strict';
import { etatMissionsUtile, missionChangeeDepuis, tourParleDesMissions, type TourEtatMissions } from './etat-missions.ts';
import { fusionnerTextesUtilisateur, MESSAGES_BLOCS_PARCOURS, MESSAGES_RECENTS_PARCOURS, MOTIFS_BLOCS_PARCOURS, sourcesServeur } from './parcours-chat.ts';
import { messageValidationApercu } from '../../../../src/lib/studio/parcours.ts';

const DERNIER = '2026-11-20T10:00:00.000Z';
const tour = (e: Partial<TourEtatMissions> = {}): TourEtatMissions => ({
  messageCourant: 'Quel est le prix moyen au m² à Bayonne ?', dernierAssistant: 'Voici les prix du quartier.', carte: false,
  missions: [{ statut: 'terminee', maj_le: '2026-11-20T09:00:00.000Z' }], dernierMessageLe: DERNIER, ...e,
});

Deno.test('VIS-19 — sans rapport avec la 3D ni les missions, missions inchangées : PAS de bloc', () => {
  na.equal(etatMissionsUtile(tour()), false);
  na.equal(etatMissionsUtile(tour({ messageCourant: 'Merci, et la taxe foncière ?' })), false);
});

Deno.test('VIS-19 — aucune mission : jamais de bloc', () => {
  na.equal(etatMissionsUtile(tour({ missions: [], messageCourant: 'Lance la plaquette' })), false);
});

Deno.test('VIS-19 — mêmes détecteurs que studioAuTour / plaquetteAuTour : bloc injecté', () => {
  na.equal(etatMissionsUtile(tour({ messageCourant: 'Prépare la plaquette' })), true);
  na.equal(etatMissionsUtile(tour({ messageCourant: 'Montre-moi en 3D' })), true);
  na.equal(etatMissionsUtile(tour({ messageCourant: 'Lance le rendu des images' })), true);
  na.equal(etatMissionsUtile(tour({ messageCourant: 'oui', dernierAssistant: 'Je lance le film ? Devis : 40 crédits.' })), true);
  na.equal(etatMissionsUtile(tour({ messageCourant: 'ok', carte: true })), true);
});

Deno.test('VIS-19 — le tour parle des missions : bloc injecté', () => {
  for (const t of ['Où en est la mission ?', 'La conception est terminée ?', 'avancement ?', 'Tu l’as lancée ?']) {
    na.equal(tourParleDesMissions(t), true, t);
    na.equal(etatMissionsUtile(tour({ messageCourant: t, dernierAssistant: null })), true, t);
  }
  na.equal(tourParleDesMissions('Quel est le prix au m² ?'), false);
});

Deno.test('VIS-19 — une mission a changé depuis le dernier message : bloc injecté', () => {
  na.equal(missionChangeeDepuis([{ statut: 'terminee', maj_le: '2026-11-20T10:05:00.000Z' }], DERNIER), true);
  na.equal(etatMissionsUtile(tour({ missions: [{ statut: 'en_cours', maj_le: '2026-11-20T08:00:00.000Z' }, { statut: 'terminee', maj_le: '2026-11-20T10:05:00.000Z' }] })), true);
  // Premier message (aucun message en base) ou date illisible : par prudence, oui.
  na.equal(etatMissionsUtile(tour({ dernierMessageLe: null })), true);
  na.equal(missionChangeeDepuis([{ statut: 'terminee', maj_le: null }], DERNIER), true);
  na.equal(missionChangeeDepuis([{ statut: 'terminee', maj_le: '2026-11-20T09:59:59.000Z' }], DERNIER), false);
  na.equal(missionChangeeDepuis([], DERNIER), false);
});

Deno.test('VIS-19 — parcours : 20 derniers messages + messages à bloc, fusionnés sans doublon, dans l’ordre', () => {
  na.equal(MESSAGES_RECENTS_PARCOURS, 20);
  na.equal(MESSAGES_BLOCS_PARCOURS, 20);
  na.deepEqual([...MOTIFS_BLOCS_PARCOURS], ['%```mimmoza-parcours%', '%```mimmoza-brief%']);
  const APERCU = '33333333-3333-4333-8333-333333333333';
  // Aperçu validé il y a longtemps (hors des 20 derniers) : retrouvé par la lecture filtrée.
  const ancien = { id: 'a', created_at: '2026-11-01T10:00:00Z', texte: messageValidationApercu(APERCU, 'film') };
  const recents = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, created_at: `2026-11-20T${String(10 + Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')}:00Z`, texte: `message ${i}` })).reverse();
  const textes = fusionnerTextesUtilisateur(recents, [ancien], [{ ...recents[0] }]);
  na.equal(textes.length, 21);
  na.equal(textes[0], ancien.texte);
  na.equal(textes[20], 'message 19');
  const s = sourcesServeur({ instantane: null, mission: null, preparation: null, travaux: [], textesUtilisateur: textes, messageCourant: 'et maintenant ?' });
  na.equal(s.apercuValide, APERCU);
  // Habillage choisi (bloc mimmoza-brief) ancien : toujours vu.
  const s2 = sourcesServeur({ instantane: null, mission: null, preparation: null, travaux: [], textesUtilisateur: fusionnerTextesUtilisateur([{ id: 'b', created_at: '2026-11-01T00:00:00Z', texte: 'ok\n```mimmoza-brief\n{}\n```' }]), messageCourant: '' });
  na.equal(s2.habillage.resume, 'Habillage choisi dans la conversation.');
});

Deno.test('VIS-19 — index.ts : bloc des missions conditionné, plus de lecture de 60 messages hors repli', async () => {
  const src = await Deno.readTextFile(new URL('../index.ts', import.meta.url));
  na.match(src, /const utile = etatMissionsUtile\(\{/);
  na.match(src, /if \(!utile\) return '';/);
  na.match(src, /buildEtatMissionsBlock\(conversationId, userId, \{/);
  na.match(src, /\.ilike\('content->0->>text', motif\)/);
  // La lecture de 60 messages ne subsiste que dans le repli (filtre refusé par la base).
  const soixante = src.match(/from\('copilot_messages'\)[^;]*?\.limit\(60\)/g) ?? [];
  na.equal(soixante.length, 1);
  na.match(src, /messagesBlocs\.some\(\(r\) => r\.error\)\s*\n\s*\? \[await admin\.from\('copilot_messages'\)/);
});
