// npx tsx --test src/spaces/copilot/studio3d/vis45ChatUnique.test.ts
// VIS-45 (25/11/2026) — UN SEUL CHAT, CELUI DE MIMMOZA, QUI PILOTE LE STUDIO (côté site).
//  1. Commande du chat → Studio ouvert (accusé) → compte rendu rangé dans la conversation (sans jetons), fichiers déposés.
//  2. Studio fermé → commande mise en attente (une seule fois par appel), phrase « s'exécutera à l'ouverture ».
//  3. Fil de la conversation publié au Studio ; saisie du Studio envoyée DANS la conversation ; notifications rangées.
//  4. Carte de l'outil `studio_commander` : envoi unique et seulement si récente ; câblage (message, page, carte du bâtiment).
//  5. Protocole : copie identique dans le Studio (si le dépôt voisin est présent).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  CLE_ENVOIS, dejaEnvoyee, doitEnvoyer, envoyerCommandeStudio, filDeLaConversation, FENETRE_ENVOI_MS, installerPontCommandesSite, lireCarteCommande,
  recevoirCompteRendu, reinitialiserCommandesSite, traceCompteRendu, useCommandesStudio, type CanalCommandes, type DepsPontSite, type TraceStudio,
} from './pontCommandesSite.ts';
import {
  CLE_COMMANDES_EN_ATTENTE, CLE_COMPTES_RENDUS_EN_ATTENTE, creerMessageCommandes, garderCompteRenduEnAttente, lireEnAttente, lireMessageCommandes, PHRASE_EN_ATTENTE,
  type ChargeCompteRendu, type MessageCommandes, type StockageSimple,
} from '../../promoteur/shared/echangeStudio/pontCommandesStudio.ts';

const ici = path.dirname(fileURLToPath(import.meta.url));
const CONV = '11111111-2222-3333-4444-555555555555';
const PROJET = `mzchat-${CONV}`;
const memoire = (): StockageSimple & { d: Map<string, string> } => { const d = new Map<string, string>(); return { d, getItem: (k) => d.get(k) ?? null, setItem: (k, v) => { d.set(k, v); } }; };

/** Canal factice : un « Studio » branché derrière (répond ou non). */
function canalAvecStudio(studio: ((m: MessageCommandes, repondre: (x: unknown) => void) => void) | null): CanalCommandes & { envoyes: MessageCommandes[]; injecter(x: unknown): void } {
  const ecouteurs = new Set<(d: unknown) => void>();
  const envoyes: MessageCommandes[] = [];
  const injecter = (x: unknown) => { for (const f of [...ecouteurs]) f(JSON.parse(JSON.stringify(x))); };
  return {
    envoyes, injecter,
    postMessage: (m) => { const lu = lireMessageCommandes(m); if (!lu.ok) return; envoyes.push(lu.message); if (studio) setTimeout(() => studio(lu.message, injecter), 5); },
    ecouter: (f) => { ecouteurs.add(f); return () => ecouteurs.delete(f); },
  };
}

const compteRendu = (requeteId: string, extra: Partial<ChargeCompteRendu> = {}): ChargeCompteRendu => ({
  requeteId, projetId: PROJET, statut: 'fait', message: 'Logement meublé en scandinave : 18 meubles.', commandeId: 'interieur-amenager', libelle: 'Aménager / meubler le logement',
  origine: { conversationId: CONV, messageId: 'msg-base-1', appelId: 'toolu_1' }, fichiers: [], surfaces: null, termineLe: Date.parse('2026-11-25T10:00:00Z'), ...extra,
});

test('VIS-45 · Studio ouvert : accusé → « en cours » ; Studio fermé : mise en attente (une fois par appel)', async () => {
  reinitialiserCommandesSite();
  const s = memoire();
  const ouvert = canalAvecStudio((m, rep) => { if (m.canal === 'commande.executer') rep(creerMessageCommandes('commande.accuse', { requeteId: m.charge.requeteId, projetId: m.charge.projetId })); });
  const d = { projetId: PROJET, conversationId: CONV, messageId: 'msg-base-1', appelId: 'toolu_1', libelle: 'Aménager', commande: { id: 'interieur-amenager', params: { style: 'scandinave' } } };
  const r1 = await envoyerCommandeStudio(d, { canal: ouvert, stockage: s, delaiMs: 200 });
  assert.equal(r1.etat, 'en-cours');
  assert.equal(ouvert.envoyes[0]!.canal, 'commande.executer');
  assert.deepEqual(lireEnAttente(s.d.get(CLE_COMMANDES_EN_ATTENTE) ?? null, Date.now()), []);
  assert.equal((await envoyerCommandeStudio(d, { canal: ouvert, stockage: s, delaiMs: 200 })).etat, 'deja', 'un appel d’outil = une commande');
  assert.equal(useCommandesStudio.getState().parAppel.toolu_1!.etat, 'en-cours');

  const ferme = canalAvecStudio(null);
  const r2 = await envoyerCommandeStudio({ ...d, appelId: 'toolu_2' }, { canal: ferme, stockage: s, delaiMs: 50 });
  assert.equal(r2.etat, 'attente');
  assert.equal(r2.message, PHRASE_EN_ATTENTE);
  const attente = lireEnAttente(s.d.get(CLE_COMMANDES_EN_ATTENTE) ?? null, Date.now());
  assert.equal(attente.length, 1);
  assert.equal(attente[0]!.origine.appelId, 'toolu_2');
  assert.ok(dejaEnvoyee(s, 'toolu_2'));
  assert.ok((s.d.get(CLE_ENVOIS) ?? '').includes('toolu_2'));
});

test('VIS-45 · compte rendu du Studio → fichiers déposés, trace rangée sur le message de Mimmo, carte à jour, une seule fois', async () => {
  reinitialiserCommandesSite();
  const ranges: { t: TraceStudio; conv: string }[] = [];
  const deposes: string[] = [];
  const deps = {
    ranger: (t: TraceStudio, conv: string) => ranges.push({ t, conv }),
    deposer: async (f: { nom: string; format: string }) => { deposes.push(f.nom); return { nom: f.nom, format: f.format, url: `https://x/${f.nom}`, chemin: `u/plans/${CONV}/r/${f.nom}`, note: null }; },
    messages: () => [], conversationCourante: () => CONV,
  };
  const vus = new Set<string>();
  const cr = compteRendu('req-abcdef1', {
    commandeId: 'plans-architecte', libelle: 'Plans d’architecte', message: 'Plans d’architecte prêts : PDF, DXF.', origine: { conversationId: CONV, messageId: 'msg-base-1', appelId: 'carte-plans-msg-base-1-x' },
    fichiers: [{ nom: 'plans-A3.pdf', mime: 'application/pdf', format: 'pdf', octets: new ArrayBuffer(4), taille: 4 }, { nom: 'plans.dxf', mime: 'application/dxf', format: 'dxf', octets: null, taille: 9 }],
    surfaces: { surfaceHabitableM2: 182.4, surfacePlancherM2: 201, empriseM2: 96.5, lignes: [] },
  });
  const suivi = await recevoirCompteRendu(cr, deps as unknown as DepsPontSite, vus);
  assert.equal(suivi?.etat, 'fait');
  assert.deepEqual(deposes, ['plans-A3.pdf'], 'seuls les octets reçus sont déposés');
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0]!.t.messageId, 'msg-base-1');
  assert.equal(ranges[0]!.t.actionKind, 'run_step');
  assert.equal(ranges[0]!.t.decidedBy, 'auto');
  assert.equal(ranges[0]!.t.params.origine, 'studio');
  assert.deepEqual((ranges[0]!.t.params.surfaces as { surfaceHabitableM2: number }).surfaceHabitableM2, 182.4);
  assert.ok(!JSON.stringify(ranges[0]!.t).includes('octets'), 'jamais d’octets en base');
  assert.equal(await recevoirCompteRendu(cr, deps as unknown as DepsPontSite, vus), null, 'traité une seule fois');
  assert.equal(useCommandesStudio.getState().parAppel['carte-plans-msg-base-1-x']!.fichiers[1]!.note, 'téléchargé dans l’onglet du Studio');
  assert.equal(traceCompteRendu({ ...cr, statut: 'confirmation' }, 'm', [], 'x').outcome, 'refused');
});

test('VIS-45 · pont installé : fil publié au Studio, saisie envoyée DANS la conversation, notifications rangées, comptes rendus en attente repris', async () => {
  const canal = canalAvecStudio(null);
  const s = memoire();
  garderCompteRenduEnAttente(s, compteRendu('req-attente-1'));
  const envoyes: string[] = [];
  const ranges: TraceStudio[] = [];
  let abonne: (() => void) | null = null;
  const messages = [
    { id: 'msg-u', role: 'user', text: 'Meuble le T3 en scandinave', status: 'complete' },
    { id: 'msg-base-1', role: 'assistant', text: 'Je lance l’aménagement.\n```mimmoza-modele\n{"x":1}\n```', status: 'complete' },
  ];
  const stop = installerPontCommandesSite({
    conversationCourante: () => CONV, messages: () => messages, traces: () => [], enCours: () => false,
    envoyer: (t) => envoyes.push(t), ranger: (t) => ranges.push(t), deposer: async () => { throw new Error('non'); },
    abonner: (f) => { abonne = f; return () => { abonne = null; }; }, canal, stockage: s,
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(ranges.length, 1, 'compte rendu laissé en attente par le Studio : repris à l’ouverture du chat');
  assert.equal(s.d.get(CLE_COMPTES_RENDUS_EN_ATTENTE), '[]');
  const fil = canal.envoyes.find((m) => m.canal === 'fil.etat');
  assert.ok(fil && fil.canal === 'fil.etat');
  assert.equal(fil.charge.projetId, PROJET);
  assert.deepEqual(fil.charge.messages.map((m) => m.texte), ['Meuble le T3 en scandinave', 'Je lance l’aménagement.']);
  assert.equal(fil.charge.envoiPossible, true);

  canal.injecter(creerMessageCommandes('fil.envoyer', { projetId: PROJET, requeteId: 'req-fil-0001', texte: 'Mets du parquet clair partout' }));
  canal.injecter(creerMessageCommandes('fil.envoyer', { projetId: 'mzchat-autre', requeteId: 'req-fil-0002', texte: 'pas pour moi' }));
  assert.deepEqual(envoyes, ['Mets du parquet clair partout']);

  canal.injecter(creerMessageCommandes('studio.notification', { projetId: PROJET, id: 'msg-studio-9', texte: 'Relief mesuré et appliqué au terrain.', quand: 1 }));
  canal.injecter(creerMessageCommandes('studio.notification', { projetId: PROJET, id: 'msg-studio-9', texte: 'Relief mesuré et appliqué au terrain.', quand: 1 }));
  assert.equal(ranges.filter((t) => t.params.type === 'notification').length, 1);
  assert.equal(ranges.at(-1)!.messageId, 'msg-base-1');

  const avant = canal.envoyes.length;
  canal.injecter(creerMessageCommandes('fil.demander', { projetId: PROJET }));
  assert.equal(canal.envoyes.length, avant + 1);
  assert.ok(abonne);
  stop();
});

test('VIS-45 · carte `studio_commander` : lue seulement si validée par le serveur ; envoi unique et récent', () => {
  const tc = { id: 'toolu_9', name: 'studio_commander', status: 'success', output: { status: 'ok', data: { carte: 'commande-studio', commande: { id: 'interieur-sol', params: { finition: 'parquet clair', etendue: 'logement' } }, phrase: null, libelle: 'Changer un sol', emis_le: 1_000_000 } } };
  const carte = lireCarteCommande(tc);
  assert.equal(carte?.commande?.id, 'interieur-sol');
  assert.equal(lireCarteCommande({ ...tc, status: 'running' }), null);
  assert.equal(lireCarteCommande({ ...tc, output: { status: 'ok', data: { carte: 'attente-accord' } } }), null);
  assert.ok(doitEnvoyer(carte!, 1_000_000 + 1000, false, false));
  assert.ok(!doitEnvoyer(carte!, 1_000_000 + FENETRE_ENVOI_MS + 1, false, false), 'conversation relue : rien ne repart');
  assert.ok(!doitEnvoyer(carte!, 1_000_100, true, false), 'compte rendu déjà en base');
  assert.ok(!doitEnvoyer(carte!, 1_000_100, false, true), 'déjà envoyée depuis ce navigateur');
});

test('VIS-45 · fil lisible : blocs techniques retirés, comptes rendus du Studio intercalés', () => {
  const f = filDeLaConversation(
    [{ id: 'a', role: 'assistant', text: 'Voici.\n```mimmoza-brief\n{}\n```' }],
    [{ messageId: 'a', message: 'Plans prêts.', params: { origine: 'studio', requeteId: 'r1' } }, { messageId: 'a', message: 'autre', params: { origine: 'x' } }],
  );
  assert.deepEqual(f.map((m) => [m.role, m.texte]), [['assistant', 'Voici.'], ['info', 'Plans prêts.']]);
});

test('VIS-45 · câblage : carte dans le message, pont monté dans la page, « Plans » = vraie commande, copies du protocole identiques', () => {
  const msg = readFileSync(path.join(ici, '../components/CopilotMessage.tsx'), 'utf8');
  assert.ok(msg.includes('lireCarteCommande(tc)') && msg.includes('<CarteCommandeStudio') && msg.includes('<LignesStudio'));
  const page = readFileSync(path.join(ici, '../MimmozIAPage.tsx'), 'utf8');
  assert.ok(page.includes('usePontCommandesStudio('));
  const carte = readFileSync(path.join(ici, 'CarteModeleBatiment.tsx'), 'utf8');
  assert.ok(carte.includes("id: 'plans-architecte'"));
  assert.ok(!carte.includes("ouvrirStudio('dessins', 'plans-vues');\n  const"), 'plus de simple ouverture d’onglet pour les plans');
  const site = readFileSync(path.join(ici, '../../promoteur/shared/echangeStudio/pontCommandesStudio.ts'), 'utf8');
  const voisin = path.resolve(ici, '../../../../../mimmozia-studio/src/core/echange/pontCommandesStudio.ts');
  if (existsSync(voisin)) assert.equal(readFileSync(voisin, 'utf8'), site, 'copie identique Studio / site');
});
