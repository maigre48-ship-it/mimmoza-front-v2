// LOT F5 (17/11/2026) — lecture de plan confiée au Studio intégré : contrôles des fichiers, blocs `planExistant` et
// `photoCalee` joints au message « projet » (sans écraser le contrat), relevé validé relu sans rien compléter.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  blocPhotoCalee, blocPlanExistant, contexteCopilotReleve, controlerFichierPlan, deposerPlanEnAttente, etatLirePlanExistant,
  FORMAT_RELEVE, lignesReleve, lireRetourReleve, memoriserReleve, oublierPlanEnAttente, photoCaleePourStudio, planEnAttente,
  releveMemorise, TYPE_RETOUR_RELEVE, typePlan, DUREE_PLAN_EN_ATTENTE_MS, type StockageReleve,
} from './planExistantStudio.ts';
import { demarrerPoigneeDeMain, type Minuterie } from '../../promoteur/shared/echangeStudio/transportStudio.ts';

const MO = 1024 * 1024;
const SESSION = '11111111-2222-4333-8444-555555555555';

test('F5-1 types et tailles : DXF sans type MIME admis, WEBP/DOCX refusés, 20 Mo au plus', () => {
  assert.equal(typePlan('rdc.dxf', ''), 'application/dxf');
  assert.equal(typePlan('rdc.DXF', 'application/octet-stream'), 'application/dxf');
  assert.equal(typePlan('plan.pdf', 'application/pdf'), 'application/pdf');
  assert.equal(typePlan('scan.jpg', 'image/jpeg'), 'image/jpeg');
  assert.equal(typePlan('scan.webp', 'image/webp'), null);
  assert.equal(controlerFichierPlan({ nom: 'notice.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', taille: 10 }).ok, false);
  assert.equal(controlerFichierPlan({ nom: 'gros.pdf', type: 'application/pdf', taille: 21 * MO }).ok, false);
  assert.equal(controlerFichierPlan({ nom: 'vide.png', type: 'image/png', taille: 0 }).ok, false);
  assert.deepEqual(controlerFichierPlan({ nom: 'ok.png', type: 'image/png', taille: 1000 }), { ok: true, type: 'image/png' });
});

test('F5-2 bloc planExistant : octets (fichier en mémoire) ou adresse https signée ; refus lisibles', () => {
  const oct = new ArrayBuffer(8);
  const ok = blocPlanExistant({ provenance: 'rehabilitation', fichiers: [{ nom: 'rdc.dxf', type: '', taille: 8, octets: oct }], maintenantMs: 0 });
  assert.ok(ok.ok);
  if (!ok.ok) return;
  assert.equal(ok.bloc.format, 'mimmoza-plan-existant');
  assert.equal(ok.bloc.ouvrir, 'import-plan');
  assert.equal(ok.bloc.fichiers[0]!.type, 'application/dxf');
  assert.equal(ok.bloc.fichiers[0]!.octets, oct);
  assert.equal(ok.bloc.expireLe, null, 'aucune adresse signée : pas d’échéance');
  assert.match(ok.bloc.mention, /aucun jeton/);
  const signe = blocPlanExistant({ provenance: 'conversation', fichiers: [{ nom: 'plan.pdf', type: 'application/pdf', taille: 10, url: 'https://x.supabase.co/storage/v1/object/sign/a?token=t' }], maintenantMs: 0 });
  assert.ok(signe.ok && signe.bloc.expireLe === new Date(3600_000).toISOString());
  assert.equal(blocPlanExistant({ provenance: 'conversation', fichiers: [{ nom: 'plan.pdf', type: 'application/pdf', taille: 10, url: 'http://x/a' }], maintenantMs: 0 }).ok, false, 'http refusé');
  assert.equal(blocPlanExistant({ provenance: 'conversation', fichiers: [{ nom: 'plan.pdf', type: 'application/pdf', taille: 10 }], maintenantMs: 0 }).ok, false, 'sans contenu');
  assert.equal(blocPlanExistant({ provenance: 'rehabilitation', fichiers: [{ nom: 'a.png', type: 'image/png', taille: 9, octets: oct }], maintenantMs: 0 }).ok, false, 'taille incohérente');
  const sept = Array.from({ length: 7 }, (_, i) => ({ nom: `n${i}.png`, type: 'image/png', taille: 8, octets: new ArrayBuffer(8) }));
  assert.equal(blocPlanExistant({ provenance: 'rehabilitation', fichiers: sept, maintenantMs: 0 }).ok, false, '7 fichiers');
  const vide = blocPlanExistant({ provenance: 'conversation', fichiers: [], maintenantMs: 0 });
  assert.ok(vide.ok && vide.bloc.fichiers.length === 0, 'sans fichier : écran d’import vide côté Studio');
});

test('F5-3 plan en attente : mémoire de l’onglet seulement, contrôlé, expiré après une heure', () => {
  oublierPlanEnAttente();
  assert.equal(deposerPlanEnAttente({ nom: 'x.webp', type: 'image/webp', taille: 4, octets: new ArrayBuffer(4), provenance: 'rehabilitation', deposeLeMs: 0 }).ok, false);
  assert.equal(planEnAttente(0), null);
  assert.ok(deposerPlanEnAttente({ nom: 'rdc.pdf', type: 'application/pdf', taille: 4, octets: new ArrayBuffer(4), provenance: 'rehabilitation', deposeLeMs: 1000 }).ok);
  assert.equal(planEnAttente(1000 + DUREE_PLAN_EN_ATTENTE_MS)?.nom, 'rdc.pdf');
  assert.equal(planEnAttente(1001 + DUREE_PLAN_EN_ATTENTE_MS), null);
});

test('F5-4 photo calée : seulement un travail d’image terminé avec photo ET plan de calage déposés ; le plus récent', () => {
  const t = (id: string, pm: unknown, statut = 'termine', type = 'image') => ({ id, type, statut, termine_le: '2026-11-16T10:00:00Z', resultat: { image_path: 'a.jpg', photomontage: pm } });
  const livre = { statut: 'livre', verdict: 'cale', atelier: null };
  const aValider = { statut: 'a_valider', verdict: 'insuffisant', mention: 'Photo Panoramax', atelier: { photo_path: 'u/j/atelier/photo.jpg', plan_path: 'u/j/atelier/plan.json' } };
  assert.equal(photoCaleePourStudio([t('a', livre)]), null, 'livré : pas de plan de calage déposé');
  assert.equal(photoCaleePourStudio([t('b', aValider, 'en_cours')]), null);
  assert.equal(photoCaleePourStudio([t('c', aValider, 'termine', 'film')]), null);
  const p = photoCaleePourStudio([t('a', livre), t('d', aValider), t('e', aValider)])!;
  assert.deepEqual(p, { travailId: 'd', photoPath: 'u/j/atelier/photo.jpg', planPath: 'u/j/atelier/plan.json', verdict: 'insuffisant', mention: 'Photo Panoramax', date: '2026-11-16T10:00:00Z' });
  assert.equal(blocPhotoCalee(p, 'http://a', 'https://b', 0), null);
  const b = blocPhotoCalee(p, 'https://a', 'https://b', 0)!;
  assert.equal(b.format, 'mimmoza-photo-calee');
  assert.equal(b.expireLe, new Date(3600_000).toISOString());
});

const RETOUR = {
  type: TYPE_RETOUR_RELEVE, version: 1, sessionId: SESSION,
  releve: {
    format: FORMAT_RELEVE, version: 1, maisonId: 'BATIMENT0000000312986202', source: 'import-plan', origine: 'rdc.dxf', cotes: [],
    baies: [
      { id: 'b1', cote: 0, type: 'fenetre', niveau: 0, positionM: { valeur: 1, statut: 'mesuree', source: 'plan' }, largeurM: { valeur: 1.2, statut: 'mesuree', source: 'plan' }, hauteurM: { valeur: 1.35, statut: 'estimee', source: 'plan' }, allegeM: { valeur: 0.9, statut: 'estimee', source: 'plan' } },
      { id: 'b2', cote: 1, type: 'porte', niveau: 0, positionM: { valeur: 2, statut: 'confirmee', source: 'x' }, largeurM: { valeur: 0.9, statut: 'confirmee', source: 'x' }, hauteurM: { valeur: 2.15, statut: 'confirmee', source: 'x' }, allegeM: { valeur: 0, statut: 'confirmee', source: 'x' } },
    ],
    avertissements: ['1 pièce(s) sans nom lu : « nom à confirmer » sur les plans.'],
  },
  synthese: {
    pieces: [
      { nom: 'Séjour', niveau: 'L0', surfaceM2: 28.456, statutSurface: 'deduit', statutNom: 'lu' },
      { nom: null, niveau: 'L0', surfaceM2: 6.2, statutSurface: 'deduit', statutNom: 'a-confirmer' },
      { nom: 'Fantôme', niveau: 'L0', surfaceM2: 'beaucoup', statutSurface: 'deduit' },
      { nom: 'Sans statut', niveau: 'L0', surfaceM2: 9 },
    ],
    murs: { exterieurs: 4, interieurs: 9 },
  },
};

test('F5-5 retour du Studio : relevé relu, pièces illisibles écartées et dites, somme au statut le moins sûr, rien complété', () => {
  assert.equal(lireRetourReleve(RETOUR, 'autre-session', 0).ok, false);
  assert.equal(lireRetourReleve({ ...RETOUR, type: 'x' }, SESSION, 0).ok, false);
  assert.equal(lireRetourReleve({ ...RETOUR, releve: { ...RETOUR.releve, format: 'autre' } }, SESSION, 0).ok, false);
  const r = lireRetourReleve(RETOUR, SESSION, 42);
  assert.ok(r.ok);
  if (!r.ok) return;
  const s = r.synthese;
  assert.equal(s.pieces.length, 2);
  assert.equal(s.ecartes.length, 2);
  assert.equal(s.surfacePiecesM2, 34.66);
  assert.equal(s.statutSurfacePieces, 'deduit');
  assert.deepEqual(s.murs, { exterieurs: 4, interieurs: 9 });
  assert.equal(s.baies.length, 2);
  assert.deepEqual([s.baies[0]!.statutLargeur, s.baies[0]!.statutHauteur], ['mesuree', 'estimee']);
  const l = lignesReleve(s).join(' ');
  assert.match(l, /plan fourni/);
  assert.match(l, /34,66 m² \(déduit/);
  const ctx = contexteCopilotReleve(s);
  assert.equal(ctx.plan_surface_retenue_m2, 34.66);
  assert.equal(ctx.plan_room_count, 2);
  assert.match(String(ctx.plan_rooms), /Séjour \(28,46 m², déduit\), pièce sans nom/);
  // Relevé sur photo : aucune pièce → aucune surface, dit comme tel.
  const photo = lireRetourReleve({ ...RETOUR, releve: { ...RETOUR.releve, source: 'photo', zonesNonVues: [{}] }, synthese: { pieces: [], murs: { exterieurs: 1, interieurs: null } } }, SESSION, 0);
  assert.ok(photo.ok && photo.synthese.surfacePiecesM2 === null);
  if (photo.ok) {
    assert.match(lignesReleve(photo.synthese).join(' '), /intérieur n’est pas connu.*1 zone/);
    assert.equal(contexteCopilotReleve(photo.synthese).plan_surface_retenue_m2, null);
  }
});

test('F5-6 mémoire du relevé (stockage injecté) et bouton de la carte (maison conservée seulement)', () => {
  const m = new Map<string, string>();
  const st: StockageReleve = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
  const r = lireRetourReleve(RETOUR, SESSION, 1);
  assert.ok(r.ok);
  if (!r.ok) return;
  memoriserReleve(st, r.synthese, 'conv-1');
  assert.equal(releveMemorise(st)?.synthese.surfacePiecesM2, 34.66);
  assert.equal(releveMemorise(st)?.conversationId, 'conv-1');
  m.set('mimmoza.releveExistant.v1', '{pas du json');
  assert.equal(releveMemorise(st), null);
  assert.equal(etatLirePlanExistant(null), false);
  assert.equal(etatLirePlanExistant({ projetEnregistre: true, projetExtension: { existants: [{ mode: 'effacer' }] } }), false);
  assert.equal(etatLirePlanExistant({ projetEnregistre: false, projetExtension: { existants: [{ mode: 'conserver' }] } }), false);
  assert.equal(etatLirePlanExistant({ projetEnregistre: true, projetExtension: { existants: [{ mode: 'conserver' }] } }), true);
});

test('F5-7 transport : planExistant et photoCalee joints au message « projet », contrat prioritaire, octets non copiés', () => {
  const envoyes: unknown[] = [];
  const minuterie: Minuterie = { setInterval: () => 1, clearInterval: () => {}, maintenant: () => 0 };
  const oct = new ArrayBuffer(8);
  const bloc = blocPlanExistant({ provenance: 'rehabilitation', fichiers: [{ nom: 'rdc.dxf', type: '', taille: 8, octets: oct }], maintenantMs: 0 });
  assert.ok(bloc.ok);
  if (!bloc.ok) return;
  const projet = { origine: 'mimmoza-front' } as never;
  const p = demarrerPoigneeDeMain({ postMessage: (m) => envoyes.push(m) }, 'https://site', SESSION, projet, {
    minuterie, complements: { planExistant: bloc.bloc, photoCalee: null, canal: 'pirate', sessionId: 'pirate' },
  });
  p.surPret(true);
  const m = envoyes[0] as Record<string, unknown>;
  assert.equal(m['canal'], 'projet');
  assert.equal(m['sessionId'], SESSION);
  assert.equal((m['planExistant'] as { fichiers: { octets: ArrayBuffer }[] }).fichiers[0]!.octets, oct);
});
