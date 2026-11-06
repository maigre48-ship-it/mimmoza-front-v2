// deno test -A supabase/functions/copilot-chat/agent/studio.test.ts
// LOT E1 — Mimmo pilote le Studio et les rendus : préparation 3D déterministe, devis puis
// confirmation des rendus, suivi honnête de la file. Aucun réseau (PGlite pour le SQL).
//
// Valeurs réglementaires : UNIQUEMENT celles de la fiche réelle du 05/11/2026 (AE0414, Nanterre) —
// hauteur 28 m à l'acrotère secteur 1 sous réserve UC 10-1, emprise non réglementée (UC 9),
// recul voie alignement ou 4 m (UC 6-1), recul limites 8 m (3 m sans baie), pleine terre 20 %,
// 1 place/logement (UC 12), programme 40 logements R+4 toiture terrasse. Les articles de UC 7 / UC 13
// et la GÉOMÉTRIE (rectangle de 50 × 40 m) sont SYNTHÉTIQUES (le contour réel n'est pas joignable ici).
import * as na from 'node:assert/strict';
import { PGlite } from 'npm:@electric-sql/pglite@0.5.15';
import {
  BRIEF_BALCONS, BRIEF_DEFAUT, BRIEF_STYLES, briefDuJeton, clausesBrief, commandeAvecBrief, encoderBrief, habillageBatiments, questionBrief, reservesBrief, validerBrief,
  controlerVolume, depotStudioSupabase, dureeAnnoncee, etatMachine, executerOutilStudio, ficheDepuisPreparation, formuleRecul,
  idRequete, jsonCanonique, lireJeton, lireRegles, niveauxDuGabarit, preparerVolume, programmeVolume, reglesVolume, signerJeton,
  studioPertinent, validerOptionsRendu,
  apercuVolume, BRIEF_BLOC_LANGUE, briefDuMessage, consigneBriefCarte,
  type ConceptionLue, type DepotStudio, type EnvStudio, type PreparationLue, type StatsFile, type TravailLu,
} from './studio.ts';
import { calculerVolumeProgramme } from './studio-front.ts';
import { appliquerSecteursDeclares, completerRegles, reglesDepuisLecture, type RegleConception } from './conception.ts';
import { NOMS_OUTILS_MISSION, outilChatAutoriseEnMission, outilsPourMission, OUTILS_CONCEPTION, OUTILS_STUDIO_CHAT } from './outils.ts';
import type { OutilDef } from './types.ts';

globalThis.fetch = (() => { throw new Error('RÉSEAU INTERDIT EN TEST'); }) as typeof fetch;

const ok = (v: unknown, m?: string) => na.ok(v, m);
const eq = (a: unknown, b: unknown, m?: string) => na.deepStrictEqual(a, b, m);

// ── Fiche de conception AE0414 (formes RÉELLES produites par conception.ts) ──────────────────────
const SOURCE = 'Règlement GPU — 92050_PLU_20251209';
const IDU = '92050000AE0414';
const USER = '0d6f1a2b-0000-4000-8000-000000000001';
const AUTRE = '0d6f1a2b-0000-4000-8000-000000000002';
const CONCEPTION_ID = '5a1c0e00-0000-4000-8000-0000000000c1';
const CONV = '7c0f0000-0000-4000-8000-0000000000aa';

function reglesAE0414(): RegleConception[] {
  const lues = reglesDepuisLecture({ regles: [
    { cle: 'emprise_sol_max_pct', nature: 'non_reglementee', valeur: null, article: 'UC 9, p. 109', texte: 'Il n’est pas fixé de règle.' },
    { cle: 'hauteur_max_m', nature: 'par_secteur', valeur: null, article: 'UC 10, p. 109', regle_relative: 'UC 10-1 : hauteur ≤ distance à l’alignement opposé + 2 m',
      valeurs_par_secteur: [{ secteur: '1', acrotere_terrasse: 28, egout: 26, faitage: 28, texte: '28 m à l’acrotère (toiture terrasse)' }] },
    { cle: 'stationnement_par_logement', nature: 'par_secteur', valeur: null, article: 'UC 12', valeurs_par_secteur: [{ secteur: 'Zone 3', valeur: 1, texte: 'Zone 3 – logements : 1 places/logement' }] },
    { cle: 'recul_voie_m', nature: 'alternative', valeur: null, article: 'UC 6-1, p. 106', texte: 'implantation à l’alignement ou en recul minimum de 4 m',
      alternatives: [{ libelle: 'alignement', valeur: 0 }, { libelle: 'recul minimum', valeur: 4 }] },
    { cle: 'recul_limites_m', valeur: 8, article: 'UC 7', texte: '8 m (3 m en l’absence de baie)' },
    { cle: 'pleine_terre_min_pct', valeur: 20, article: 'UC 13', texte: '20 % de pleine terre' },
  ] }, 'gpu', SOURCE);
  return completerRegles(appliquerSecteursDeclares(lues, { hauteur: '1', stationnement: '3', toiture: 'terrasse' }).regles);
}

const LON = 2.2068, LAT = 48.892, KX = 111_320 * Math.cos(LAT * Math.PI / 180);
function rectangle(l: number, h: number) {
  const ring = [[0, 0], [l, 0], [l, h], [0, h]].map(([x, y]) => [LON + x / KX, LAT + y / 111_320]);
  return { type: 'Polygon' as const, coordinates: [[...ring, ring[0]]] };
}

function conceptionAE0414(l = 50, h = 40): ConceptionLue {
  return {
    id: CONCEPTION_ID, idu: IDU, commune: 'Nanterre',
    parcelle: { idu: IDU, geometrie: rectangle(l, h), surface_m2: l * h, source: 'synthétique (test)' },
    regles_plu: reglesAE0414(),
    programme: { nb_logements: 40, typologies: {}, shab_cible_m2: null, sdp_cible_m2: null, gabarit: 'R+4', stationnement: null, toiture: 'terrasse' },
  };
}

// ── Dépôt en mémoire ──────────────────────────────────────────────────────────────────────────────
class DepotMemoire implements DepotStudio {
  conceptions: Array<ConceptionLue & { user_id: string }> = [];
  versions: Array<{ user_id: string; conception_id: string; n: number; modele_ref: string }> = [];
  preparations: Array<PreparationLue & { user_id: string; origine: string; version_calcul: string }> = [];
  travaux: Array<TravailLu & { user_id: string; fiche: Record<string, unknown>; options: Record<string, unknown> }> = [];
  imageAutorisee: boolean | null = true;
  stats: StatsFile | null = { attente: 0, plusAncienneAttente: null, enCours: 0, derniereActivite: null };
  erreurInsertion: string | null = null;
  inserts = 0;
  async conception(u: string, q: { id?: string | null; idu?: string | null }) {
    return this.conceptions.filter((c) => c.user_id === u && (!q.id || c.id === q.id) && (!q.idu || c.idu === q.idu)).at(-1) ?? null;
  }
  async derniereVersion(u: string, cid: string) {
    const v = this.versions.filter((x) => x.user_id === u && x.conception_id === cid).sort((a, b) => b.n - a.n)[0];
    return v ? { n: v.n, modele_ref: v.modele_ref } : null;
  }
  async enregistrerPreparation(u: string, l: Omit<PreparationLue, 'id' | 'cree_le'> & { origine: 'chat' | 'mission'; version_calcul: string }) {
    const deja = this.preparations.find((p) => p.user_id === u && p.empreinte === l.empreinte);
    if (deja) { deja.conversation_id = l.conversation_id; return deja.id; }
    const id = crypto.randomUUID();
    this.preparations.push({ ...structuredClone(l), id, user_id: u, cree_le: new Date().toISOString() });
    return id;
  }
  async preparation(u: string, q: { id?: string | null; conceptionId?: string | null; conversationId?: string | null }) {
    if (!q.id && !q.conceptionId && !q.conversationId) return null;
    return this.preparations.filter((p) => p.user_id === u && (!q.id || p.id === q.id) && (!q.conceptionId || p.conception_id === q.conceptionId)
      && (!q.conversationId || p.conversation_id === q.conversationId)).at(-1) ?? null;
  }
  async typeRenduAutorise() { return this.imageAutorisee; }
  async statsFile() { return this.stats; }
  async travauxActifs(u: string) { return this.travaux.filter((t) => t.user_id === u && ['en_attente', 'en_cours'].includes(t.statut)).length; }
  async travailParDevis(u: string, d: string) { return this.travaux.find((t) => t.user_id === u && t.fiche.devis_id === d) ?? null; }
  /** Historique copilot_tool_calls simulé : sorties de studio_lancer_rendu enregistrées EN FIN de requête. */
  appels: Array<{ user_id: string; conversation_id: string; sortie: Record<string, unknown> }> = [];
  async questionBriefPosee(u: string, c: string) {
    return this.appels.some((a) => a.user_id === u && a.conversation_id === c && (a.sortie.data as { brief_requis?: unknown } | undefined)?.brief_requis === true);
  }
  async jetonsDevis(u: string, c: string) {
    return this.appels.filter((a) => a.user_id === u && a.conversation_id === c).reverse()
      .map((a) => (a.sortie.data as { jeton_devis?: unknown } | undefined)?.jeton_devis).filter((j): j is string => typeof j === 'string');
  }
  /** Fin de requête : comme saveAssistantMessage, enregistre la sortie (publique) de l'outil. */
  persister(r: unknown, u = USER, c = CONV) { this.appels.push({ user_id: u, conversation_id: c, sortie: structuredClone(r) as Record<string, unknown> }); }
  async insererTravail(u: string, l: { conversation_id: string; type: string; fiche: Record<string, unknown>; options: Record<string, unknown> }) {
    if (this.erreurInsertion) throw new Error(this.erreurInsertion);
    this.inserts++;
    const t = { id: crypto.randomUUID(), user_id: u, conversation_id: l.conversation_id, type: l.type, statut: 'en_attente', progression: 0, etape: null,
      resultat: null, elements_omis: [], erreur: null, cree_le: new Date(Date.now()).toISOString(), demarre_le: null, termine_le: null, fiche: l.fiche, options: l.options };
    this.travaux.push(t);
    return t;
  }
  async travail(u: string, q: { id?: string | null; conversationId?: string | null }) {
    return this.travaux.filter((t) => t.user_id === u && (!q.id || t.id === q.id) && (!q.conversationId || t.conversation_id === q.conversationId)).at(-1) ?? null;
  }
  async positionFile() { return 3; }
  async urlSigneeRendu(c: string) { return `https://fwvrqngbafqdaekbdfnm.supabase.co/storage/v1/object/sign/studio-rendus/${c}?token=t`; }
}

/** Brief « à toi de choisir » : valeurs proposées (E1-brief). */
const B = { a_toi_de_choisir: true };

function env(depot: DepotStudio, requete = 'requete-1', extra: Partial<EnvStudio> = {}): EnvStudio {
  return { userId: USER, depot, secret: 'secret-de-test', requete, conversationId: CONV, origine: 'https://mimmoza.vercel.app', ...extra };
}
function depotAvecConception(): DepotMemoire {
  const d = new DepotMemoire();
  d.conceptions.push({ ...conceptionAE0414(), user_id: USER });
  return d;
}

// ═══ 1. Préparation déterministe ═══════════════════════════════════════════════════════════════

Deno.test('E1-1 : AE0414 — volume du moteur du Dossier 3D, chiffres et vérifications déterministes, jamais « conforme »', async () => {
  const p = await preparerVolume(conceptionAE0414());
  ok(p.ok, !p.ok ? p.raison : '');
  if (!p.ok) return;
  const r = p.resume;
  eq([r.statut, r.batiments, r.niveaux, r.gabarit, r.hauteur_indicative_m, r.recul_applique_m], ['calcule', 1, 5, 'R+4', 15, 8]);
  eq([r.emprise_batie_m2, r.sdp_estimee_m2, r.logements_places, r.logements_vises, r.programme_atteint], [544, 2720, 38, 40, false]);
  ok(r.alertes.some((a) => /programme non atteint/.test(a)), 'programme non atteint dit');
  const v = Object.fromEntries(r.controles.map((c) => [c.cle, c.verdict]));
  eq(v, {
    hauteur_max_m: 'a_verifier',            // condition UC 10-1 non vérifiée
    emprise_sol_max_pct: 'dans_la_limite',  // non réglementée, citée (UC 9)
    recul_voie_m: 'dans_la_limite',
    recul_limites_m: 'dans_la_limite',
    pleine_terre_min_pct: 'a_verifier',     // voirie / stationnement non déduits
    stationnement_par_logement: 'non_controle',
  });
  ok(r.controles.find((c) => c.cle === 'hauteur_max_m')!.explication.includes('UC 10-1'));
  ok(!/conforme|respecte le PLU/i.test(JSON.stringify(r)), 'aucune affirmation de conformité');
  // Gabarit R+4 = plafond de projet, présenté comme tel (pas une règle PLU).
  ok(r.regles_appliquees.some((l) => /gabarit R\+4\) — choix du projet, pas une règle PLU/.test(l)));
  // Emprise non réglementée → plafond 100 % (pas les 40 % par défaut), la pleine terre borne à 80 %.
  ok(r.hypotheses.some((h) => /bornée à 80 %/.test(h)), r.hypotheses.join(' | '));
  // Déterminisme : même entrée → même volume, même empreinte.
  const p2 = await preparerVolume(conceptionAE0414());
  ok(p2.ok && p2.empreinte === p.empreinte && jsonCanonique(p2.volume) === jsonCanonique(p.volume));
  ok(/^[0-9a-f]{64}$/.test(p.empreinte));
});

Deno.test('E1-2 : parité — conversion des règles identique à celle du Dossier 3D (reglesPlu.ts du front)', async () => {
  // Import dynamique : reglesPlu.ts n'est pas vérifiable par Deno (imports du front sans extension), mais il s'exécute.
  const chemin = new URL('../../../../src/spaces/copilot/studio3d/reglesPlu.ts', import.meta.url).href;
  const front = await import(chemin) as { lotsReglesDesMessages: (m: unknown[]) => Array<{ regles: Array<Record<string, unknown>> }> };
  // Règles chiffrées seulement (l'« emprise non réglementée » et le gabarit sont des ajouts E1, testés à part).
  const regles = reglesAE0414().filter((r) => r.nature !== 'non_reglementee');
  const [lot] = front.lotsReglesDesMessages([{ role: 'assistant', toolCalls: [{ name: 'enregistrer_regles_conception', status: 'success', input: { regles } }] }]);
  const valides = (l: Array<Record<string, unknown>>) => l.filter((r) => (r.valeur as number) > 0).map((r) => jsonCanonique({ ...r, minimumM: r.minimumM ?? null }));
  eq(valides(reglesVolume(lireRegles(regles), null).regles as unknown as Array<Record<string, unknown>>).sort(), valides(lot.regles).sort());
  // Le volume de la préparation est celui du moteur appelé directement.
  const c = conceptionAE0414();
  const p = await preparerVolume(c);
  ok(p.ok);
  const direct = calculerVolumeProgramme((c.parcelle as { geometrie: never }).geometrie, programmeVolume(c.programme),
    reglesVolume(lireRegles(c.regles_plu), niveauxDuGabarit('R+4')));
  eq(jsonCanonique(p.ok && p.volume), jsonCanonique(direct));
});

Deno.test('E1-3 : règle estimée (non citée) → jamais « dans la limite » ; formule H/k ; gabarit', async () => {
  const c = conceptionAE0414();
  c.regles_plu = (c.regles_plu as RegleConception[]).map((r) => (r.cle === 'recul_limites_m' ? { ...r, statut: 'estime' as const } : r));
  const p = await preparerVolume(c);
  ok(p.ok);
  eq(p.ok && p.resume.controles.find((x) => x.cle === 'recul_limites_m')!.verdict, 'a_verifier');
  eq(formuleRecul('H/2 min 4 m'), { diviseur: 2, minimumM: 4 });
  eq(formuleRecul('8 m'), null);
  eq([niveauxDuGabarit('R+4'), niveauxDuGabarit('RDC'), niveauxDuGabarit('collectif')], [5, 1, null]);
  eq(programmeVolume({ nb_logements: null }).logements, null, 'jamais de programme inventé');
});

Deno.test('E1-4 : contour manquant ou parcelle trop petite → aucune préparation, raison lisible', async () => {
  const sans = { ...conceptionAE0414(), parcelle: null };
  const p = await preparerVolume(sans);
  ok(!p.ok && /contour cadastral/.test(p.raison));
  const petite = await preparerVolume(conceptionAE0414(12, 10));
  ok(!petite.ok && /Aucun volume/.test(petite.raison), JSON.stringify(petite));
});

Deno.test('E1-5 : outil studio_preparer_3d — enregistre (idempotent), réponse compacte en mission, conception d’un autre refusée', async () => {
  const d = depotAvecConception();
  const r1 = await executerOutilStudio('studio_preparer_3d', { idu: IDU }, env(d));
  eq(r1?.status, 'ok', r1?.message);
  const r2 = await executerOutilStudio('studio_preparer_3d', {}, env(d));
  eq(r2?.data?.preparation_id, r1?.data?.preparation_id, 'même calcul → même ligne');
  eq(d.preparations.length, 1);
  ok(/Ouvrir la 3D préparée/.test(String(r1?.data?.ouverture)));
  // Autre utilisateur : ne voit pas la conception.
  const r3 = await executerOutilStudio('studio_preparer_3d', { conception_id: CONCEPTION_ID }, { ...env(d), userId: AUTRE });
  eq(r3?.status, 'not_found');
  // Mission : conception en mémoire, résumé compact (< 3 000 caractères), origine « mission ».
  const dm = new DepotMemoire();
  const rm = await executerOutilStudio('studio_preparer_3d', {}, { ...env(dm), secret: null, mission: true, conception: conceptionAE0414() });
  eq(rm?.status, 'ok');
  ok(JSON.stringify(rm).length < 3000, String(JSON.stringify(rm).length));
  eq(dm.preparations[0].origine, 'mission');
  // Sans session : refus explicite.
  eq((await executerOutilStudio('studio_preparer_3d', {}, { ...env(d), userId: null }))?.status, 'error');
});

// ═══ 2. Rendus : devis puis confirmation ═══════════════════════════════════════════════════════

async function preparer(d: DepotMemoire): Promise<string> {
  const r = await executerOutilStudio('studio_preparer_3d', {}, env(d));
  return String(r?.data?.preparation_id);
}

Deno.test('E1-6 : devis — rien n’est lancé ; jeton signé lisible dans le rappel des résultats (900 caractères)', async () => {
  const d = depotAvecConception();
  await preparer(d);
  const r = await executerOutilStudio('studio_lancer_rendu', { brief: B, type: 'image', options: { vues: ['face', 'trois_quarts_gauche'] } }, env(d));
  eq(r?.status, 'confirmation_requise', r?.message);
  eq(d.inserts, 0, 'aucune insertion au devis');
  const devis = r!.data!.devis as Record<string, unknown>;
  eq(devis.jetons, 0);
  ok(/Aucun jeton débité/.test(String(devis.cout_jetons)));
  ok(/1 h 37 à 2 h 17|environ/.test(String(devis.duree)));
  ok(/3D préparée par Mimmo/.test(String(devis.source)));
  ok((devis.avertissements as string[]).some((a) => /terrain supposé plat/.test(a)));
  // Le rappel des résultats précédents (index.ts) garde les 900 premiers caractères de la sortie.
  const sortie = JSON.stringify(r);
  const jeton = String(r!.data!.jeton_devis);
  ok(sortie.indexOf(jeton) + jeton.length < 900, `jeton à ${sortie.indexOf(jeton)} (+${jeton.length})`);
  ok(/RIEN N'A ÉTÉ LANCÉ/.test(r!.message!));
});

Deno.test('E1-7 : confirmation — refusée dans la même requête, acceptée au message suivant, jamais deux fois', async () => {
  const d = depotAvecConception();
  await preparer(d);
  const devis = await executerOutilStudio('studio_lancer_rendu', { brief: B, type: 'film', options: { duree_s: 30 } }, env(d, 'rq-A'));
  const jeton = devis!.data!.jeton_devis;
  const meme = await executerOutilStudio('studio_lancer_rendu', { type: 'film', confirmer: true, jeton_devis: jeton }, env(d, 'rq-A'));
  eq(meme?.status, 'error'); ok(/message SUIVANT/.test(meme!.message!)); eq(d.inserts, 0);
  const sans = await executerOutilStudio('studio_lancer_rendu', { type: 'film', confirmer: true }, env(d, 'rq-B'));
  eq(sans?.status, 'error'); eq(d.inserts, 0);
  const autreType = await executerOutilStudio('studio_lancer_rendu', { type: 'visite360', confirmer: true, jeton_devis: jeton }, env(d, 'rq-B'));
  eq(autreType?.status, 'error'); eq(d.inserts, 0);
  const lance = await executerOutilStudio('studio_lancer_rendu', { type: 'film', confirmer: true, jeton_devis: jeton }, env(d, 'rq-B'));
  eq(lance?.status, 'ok', lance?.message);
  eq([d.inserts, lance!.data!.statut], [1, 'en_attente']);
  const t = d.travaux[0];
  eq([t.type, t.conversation_id, t.options], ['film', CONV, { duree_s: 30, ambiance: 'jour', format: '16:9', interieurs: true, musique: true }]);
  // Fiche = projet v2 « Voir en 3D » valide (même code que le front) + devis_id ; le worker lit fiche.charge.
  const charge = t.fiche.charge as Record<string, unknown>;
  eq([charge.format, (charge.site as { parcelles: unknown[] }).parcelles.length, typeof t.fiche.devis_id], ['mimmoza-projet-v2', 1, 'string']);
  ok(/R\+4/.test(String((t.fiche.draft as { objectif: string }).objectif)));
  // Rejouer la confirmation : rien de relancé.
  const bis = await executerOutilStudio('studio_lancer_rendu', { type: 'film', confirmer: true, jeton_devis: jeton }, env(d, 'rq-C'));
  eq([bis?.status, bis?.data?.deja_lance, d.inserts], ['ok', true, 1]);
});

Deno.test('E1-7bis : boucle du 05/11 — devis expiré, « ok go », nouveau devis : confirmable au message suivant, sans recopier le jeton', async () => {
  const d = depotAvecConception();
  await preparer(d);
  const t0 = Date.now();
  const opts = { vues: ['trois_quarts_gauche', 'trois_quarts_droite'], ambiance: 'jour' };
  // R1 : devis présenté.
  const r1 = await executerOutilStudio('studio_lancer_rendu', { brief: B, type: 'image', options: opts }, env(d, 'R1', { maintenant: () => t0 }));
  eq(r1?.status, 'confirmation_requise');
  ok(/\d{2}h\d{2} \(heure de Paris\)/.test(String((r1!.data!.devis as Record<string, unknown>).valable_jusqu_a)));
  d.persister(r1);
  // R2, 2 h 05 plus tard : « ok go » → le devis de R1 est expiré, refus explicite.
  const tard = t0 + 125 * 60_000;
  const go = await executerOutilStudio('studio_lancer_rendu', { type: 'image', confirmer: true, jeton_devis: r1!.data!.jeton_devis }, env(d, 'R2', { maintenant: () => tard }));
  eq(go?.status, 'error'); ok(/expiré/.test(go!.message!)); eq(d.inserts, 0);
  // R2 : nouveau devis (même tour) — sa confirmation dans R2 est refusée.
  const r2 = await executerOutilStudio('studio_lancer_rendu', { brief: B, type: 'image', options: opts }, env(d, 'R2', { maintenant: () => tard }));
  eq([r2?.status, r2?.data?.deja_presente], ['confirmation_requise', undefined]);
  const meme = await executerOutilStudio('studio_lancer_rendu', { type: 'image', confirmer: true }, env(d, 'R2', { maintenant: () => tard }));
  eq(meme?.status, 'error'); eq(d.inserts, 0);
  d.persister(r2);
  // R3 : « go ». Même si le modèle refait d'abord un devis, il récupère CELUI DE R2 (même jeton)…
  const r3 = await executerOutilStudio('studio_lancer_rendu', { brief: B, type: 'image', options: opts }, env(d, 'R3', { maintenant: () => tard + 60_000 }));
  eq([r3?.data?.deja_presente, r3?.data?.jeton_devis], [true, r2!.data!.jeton_devis]);
  ok(/IMMÉDIATEMENT/.test(r3!.message!));
  // … et la confirmation SANS jeton passe, dans ce même tour R3.
  const lance = await executerOutilStudio('studio_lancer_rendu', { type: 'image', confirmer: true }, env(d, 'R3', { maintenant: () => tard + 60_000 }));
  eq(lance?.status, 'ok', lance?.message); eq(d.inserts, 1);
  eq(d.travaux[0].fiche.devis_id, (await lireJeton(r2!.data!.jeton_devis, 'secret-de-test'))!.id);
  // Un nouveau « go » ne relance rien ; un nouveau devis n'est plus « déjà présenté » (celui-ci est lancé).
  const bis = await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env(d, 'R4', { maintenant: () => tard + 120_000 }));
  eq([bis?.status, bis?.data?.deja_lance, d.inserts], ['ok', true, 1]);
  const nouveau = await executerOutilStudio('studio_lancer_rendu', { brief: B, type: 'image', options: opts }, env(d, 'R4', { maintenant: () => tard + 120_000 }));
  eq(nouveau?.data?.deja_presente, undefined);
});

Deno.test('E1-7ter : devis non expiré de R1 confirmé en R2 sans jeton ; jeton faux du modèle → devis de la conversation ; autres conversations ignorées', async () => {
  const d = depotAvecConception();
  await preparer(d);
  const r1 = await executerOutilStudio('studio_lancer_rendu', { brief: B, type: 'film', options: { duree_s: 30 } }, env(d, 'R1'));
  d.persister(r1);
  // Un devis d'une AUTRE conversation ou d'un AUTRE utilisateur n'est jamais repris.
  d.appels = d.appels.map((a) => ({ ...a, conversation_id: 'autre-conversation' }));
  eq((await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env(d, 'R2')))?.status, 'error');
  d.appels = [];
  d.persister(r1, AUTRE);
  eq((await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env(d, 'R2')))?.status, 'error');
  eq(d.inserts, 0);
  d.appels = [];
  d.persister(r1);
  // Autre type demandé → refus.
  eq((await executerOutilStudio('studio_lancer_rendu', { type: 'visite360', confirmer: true }, env(d, 'R2')))?.status, 'error');
  // Jeton tronqué par le modèle → le serveur reprend le devis présenté.
  const l = await executerOutilStudio('studio_lancer_rendu', { type: 'film', confirmer: true, jeton_devis: 'tronque…' }, env(d, 'R2'));
  eq(l?.status, 'ok', l?.message); eq(d.inserts, 1);
  // Paramètres différents → nouveau devis, pas de reprise.
  const autre = await executerOutilStudio('studio_lancer_rendu', { brief: B, type: 'film', options: { duree_s: 60 } }, env(d, 'R3'));
  eq(autre?.data?.deja_presente, undefined);
});

Deno.test('E1-8 : jeton falsifié, d’un autre utilisateur ou expiré → refus, rien de lancé', async () => {
  const d = depotAvecConception();
  await preparer(d);
  const devis = await executerOutilStudio('studio_lancer_rendu', { brief: B, type: 'visite360' }, env(d, 'rq-1'));
  const jeton = String(devis!.data!.jeton_devis);
  const [corps, sig] = jeton.split('.');
  const falsifie = `${corps.slice(0, -2)}AA.${sig}`;
  eq((await executerOutilStudio('studio_lancer_rendu', { confirmer: true, jeton_devis: falsifie }, env(d, 'rq-2')))?.status, 'error');
  eq((await executerOutilStudio('studio_lancer_rendu', { confirmer: true, jeton_devis: jeton }, { ...env(d, 'rq-2'), userId: AUTRE }))?.status, 'error');
  const tard = await executerOutilStudio('studio_lancer_rendu', { confirmer: true, jeton_devis: jeton }, { ...env(d, 'rq-2'), maintenant: () => Date.now() + 121 * 60_000 });
  ok(/expiré/.test(tard!.message!));
  eq((await executerOutilStudio('studio_lancer_rendu', { confirmer: true, jeton_devis: jeton }, { ...env(d, 'rq-2'), secret: 'autre-secret' }))?.status, 'error');
  eq(d.inserts, 0);
  // Le jeton porte le type, les options normalisées et la source.
  const c = await lireJeton(jeton, 'secret-de-test');
  eq([c?.t, c?.o, c?.s.genre], ['visite360', { ambiance: 'jour', interieurs: true, resolution: '6k' }, 'preparation']);
});

Deno.test('E1-9 : image — refusée tant que la base ne l’autorise pas (E0), sans dépendre d’E0 pour film / visite', async () => {
  const d = depotAvecConception();
  await preparer(d);
  d.imageAutorisee = false;
  const r = await executerOutilStudio('studio_lancer_rendu', { brief: B, type: 'image' }, env(d));
  eq(r?.status, 'not_configured'); ok(/lot E0/.test(r!.message!));
  eq((await executerOutilStudio('studio_lancer_rendu', { brief: B, type: 'film' }, env(d)))?.status, 'confirmation_requise');
  // Base muette (sonde impossible) : le devis est établi ; le refus de la base à l'insertion est traduit.
  d.imageAutorisee = null;
  const devis = await executerOutilStudio('studio_lancer_rendu', { brief: B, type: 'image' }, env(d, 'rq-1'));
  eq(devis?.status, 'confirmation_requise');
  d.erreurInsertion = 'new row for relation "studio_jobs" violates check constraint "studio_jobs_type_check" (23514)';
  const l = await executerOutilStudio('studio_lancer_rendu', { confirmer: true, jeton_devis: devis!.data!.jeton_devis }, env(d, 'rq-2'));
  eq(l?.status, 'not_configured'); eq(d.inserts, 0);
  d.erreurInsertion = 'Vous avez déjà 2 films ou visites en préparation. Attendez qu\'un des deux se termine.';
  d.imageAutorisee = true;
  const p = await executerOutilStudio('studio_lancer_rendu', { confirmer: true, jeton_devis: devis!.data!.jeton_devis }, env(d, 'rq-3'));
  ok(/déjà 2 rendus/.test(p!.message!));
});

Deno.test('E1-10 : source — la version enregistrée dans l’Atelier prime (rendu fidèle, modele_ref) ; rien à rendre → refus', async () => {
  const d = depotAvecConception();
  d.versions.push({ user_id: USER, conception_id: CONCEPTION_ID, n: 2, modele_ref: `${USER}/${CONCEPTION_ID}/modele-v2-a1b2c3d4.mstudio.json` });
  const devis = await executerOutilStudio('studio_lancer_rendu', { type: 'film', conception_id: CONCEPTION_ID }, env(d, 'rq-1'));
  ok(/version 2 enregistrée/.test(String((devis!.data!.devis as Record<string, unknown>).source)));
  await executerOutilStudio('studio_lancer_rendu', { confirmer: true, jeton_devis: devis!.data!.jeton_devis }, env(d, 'rq-2'));
  eq(d.travaux[0].fiche.conception, { conception_id: CONCEPTION_ID, n: 2, modele_ref: `${USER}/${CONCEPTION_ID}/modele-v2-a1b2c3d4.mstudio.json` });
  const vide = new DepotMemoire();
  eq((await executerOutilStudio('studio_lancer_rendu', { type: 'film' }, env(vide)))?.status, 'not_found');
  // Plafond de 2 rendus actifs : pas de devis.
  d.travaux.push({ ...d.travaux[0], id: crypto.randomUUID(), fiche: {} });
  ok(/déjà 2 rendus/.test((await executerOutilStudio('studio_lancer_rendu', { type: 'film' }, env(d)))!.message!));
  // Jamais de rendu en mission.
  eq((await executerOutilStudio('studio_lancer_rendu', { type: 'film' }, { ...env(d), mission: true }))?.status, 'error');
});

Deno.test('E1-11 : options — mêmes règles que _studio_job_options_valides (SQL réel, PGlite)', async () => {
  const db = new PGlite();
  for (const f of ['20261026_studio_jobs.sql', '20261102120000_studio_jobs_image.sql']) {
    let sql: string;
    try { sql = await Deno.readTextFile(new URL(`../../../migrations/${f}`, import.meta.url)); } catch { continue; }
    const m = /create or replace function public\._studio_job_options_valides[\s\S]*?\n\$\$;/.exec(sql);
    ok(m, `fonction absente de ${f}`);
    await db.exec(m![0]);
  }
  const cas: Array<[string, unknown]> = [
    ['film', {}], ['film', { duree_s: 90, format: '9:16', musique: false }], ['film', { duree_s: 45 }], ['film', { ambiance: 'aube' }],
    ['film', { resolution: '8k' }], ['film', { interieurs: 'oui' }], ['visite360', { resolution: '8k', ambiance: 'nuit' }],
    ['visite360', { resolution: '4k' }], ['visite360', { duree_s: 30 }], ['image', {}], ['image', { vues: ['face', 'trois_quarts_droite'] }],
    ['image', { vues: [] }], ['image', { vues: ['face', 'face'] }], ['image', { vues: ['dessus'] }], ['image', { ambiance: 'nuit' }],
    ['image', { vues: ['face', 'trois_quarts_gauche', 'trois_quarts_droite'], ambiance: 'fin_de_journee' }], ['inconnu', {}],
  ];
  for (const [type, o] of cas) {
    const sqlOk = (await db.query<{ v: boolean }>('select public._studio_job_options_valides($1, $2::jsonb) as v', [type, JSON.stringify(o)])).rows[0].v;
    const ts = validerOptionsRendu(type, o);
    eq(ts.ok, sqlOk, `${type} ${JSON.stringify(o)}`);
    if (ts.ok) eq((await db.query<{ v: boolean }>('select public._studio_job_options_valides($1, $2::jsonb) as v', [type, JSON.stringify(ts.valeur)])).rows[0].v, true, 'options normalisées acceptées');
  }
  await db.close();
});

// ═══ 3. Suivi honnête ════════════════════════════════════════════════════════════════════════════

Deno.test('E1-12 : machine de rendu — état DÉDUIT de la file, « hors ligne » dit quand rien ne bouge', () => {
  const t = Date.parse('2026-11-05T12:00:00Z');
  const il = (min: number) => new Date(t - min * 60_000).toISOString();
  eq(etatMachine({ attente: 1, plusAncienneAttente: il(2), enCours: 1, derniereActivite: il(1) }, t).etat, 'occupee');
  const s = etatMachine({ attente: 2, plusAncienneAttente: il(45), enCours: 0, derniereActivite: il(60 * 26) }, t);
  eq(s.etat, 'silencieuse'); ok(/probablement éteinte/.test(s.phrase) && /EN ATTENTE/.test(s.phrase), s.phrase);
  eq(etatMachine({ attente: 0, plusAncienneAttente: null, enCours: 0, derniereActivite: il(5) }, t).etat, 'active_recemment');
  const i = etatMachine({ attente: 0, plusAncienneAttente: null, enCours: 0, derniereActivite: null }, t);
  eq(i.etat, 'inconnue'); ok(/peut être éteinte/.test(i.phrase));
  eq(etatMachine(null, t).etat, 'inconnue');
  ok(/12 h/.test(dureeAnnoncee('film', {})) && /6 h/.test(dureeAnnoncee('visite360', {})));
});

Deno.test('E1-13 : studio_etat_rendu — statut réel, position en file, liens du résultat', async () => {
  const d = depotAvecConception();
  await preparer(d);
  const devis = await executerOutilStudio('studio_lancer_rendu', { brief: B, type: 'film' }, env(d, 'rq-1'));
  await executerOutilStudio('studio_lancer_rendu', { confirmer: true, jeton_devis: devis!.data!.jeton_devis }, env(d, 'rq-2'));
  d.stats = { attente: 4, plusAncienneAttente: new Date(Date.now() - 50 * 60_000).toISOString(), enCours: 0, derniereActivite: null };
  const att = await executerOutilStudio('studio_etat_rendu', {}, env(d));
  eq([att?.data?.statut, att?.data?.position_file], ['en_attente', 3]);
  ok(/pas encore pris/.test(String(att?.data?.statut_libelle)) && /probablement éteinte/.test(String(att?.data?.machine)));
  Object.assign(d.travaux[0], { statut: 'termine', progression: 100, etape: 'Terminé', resultat: { video_path: `${USER}/j/film.mp4`, poster_path: `${USER}/j/poster.jpg`, avertissements: ['Terrain supposé plat.'] } });
  const fin = await executerOutilStudio('studio_etat_rendu', {}, env(d));
  const liens = fin!.data!.liens as Record<string, string>;
  ok(liens.video.includes('/sign/studio-rendus/') && liens.affiche.includes('poster.jpg'));
  Object.assign(d.travaux[0], { type: 'visite360', resultat: { visite_id: 'Abcdef123456', manifest_path: 'x' } });
  eq(((await executerOutilStudio('studio_etat_rendu', {}, env(d)))!.data!.liens as Record<string, string>).visite, 'https://mimmoza.vercel.app/visite/Abcdef123456');
  eq((await executerOutilStudio('studio_etat_rendu', {}, { ...env(d), userId: AUTRE }))?.status, 'not_found');
});

Deno.test('E1-14 : fiche de rendu d’une préparation multi-bâtiments — bâtiments v2 + avertissement de fidélité', async () => {
  const d = new DepotMemoire();
  const c = conceptionAE0414(90, 70);
  c.programme = { nb_logements: 80, typologies: {}, gabarit: 'R+4' };
  d.conceptions.push({ ...c, user_id: USER });
  const r = await executerOutilStudio('studio_preparer_3d', {}, env(d));
  eq(r?.status, 'ok', r?.message);
  const prep = d.preparations[0];
  const n = (prep.volume as { batiments?: unknown[] }).batiments?.length ?? 1;
  ok(n >= 2, `bâtiments : ${n}`);
  const f = ficheDepuisPreparation(prep, CONV, '2026-11-05T12:00:00.000Z', crypto.randomUUID(), 'https://mimmoza.vercel.app');
  ok(f.ok);
  eq(f.ok && (f.valeur.charge as { batiments: unknown[] }).batiments.length, n);
  const devis = await executerOutilStudio('studio_lancer_rendu', { brief: B, type: 'film' }, env(d));
  // E1-fidélité : le worker construit chaque bâtiment à sa place (worker/src/batimentsScene.ts du Studio).
  const av = (devis!.data!.devis as Record<string, unknown>).avertissements as string[];
  ok(av.some((a) => /chacun est reconstruit à sa place/.test(a)), av.join(' | '));
  ok(!av.some((a) => /disposition peut différer/.test(a)));
});

// Contour RÉEL de 92050000AE0414 (charge du travail studio_jobs 2825784c du 05/11/2026, worker local).
const CONTOUR_REEL_AE0414 = { type: 'MultiPolygon' as const, coordinates: [[[[2.21036794, 48.89546307], [2.21057146, 48.89555174], [2.21059178, 48.89556078],
  [2.21072456, 48.89561975], [2.21076629, 48.89563828], [2.21089857, 48.89561289], [2.21109561, 48.89539142], [2.21118122, 48.89529513],
  [2.21121383, 48.89525883], [2.21140544, 48.89504452], [2.21142958, 48.8950177], [2.21099728, 48.89492258], [2.21065092, 48.89481778],
  [2.21020409, 48.89525838], [2.21019357, 48.89526875], [2.21015183, 48.89532297], [2.21017117, 48.89537868], [2.21031712, 48.89544133],
  [2.21036794, 48.89546307]]]] };

Deno.test('E1-19 : AE0414 réelle (R+4, 40 logements) — fiche du travail du 05/11 : 2 barres R+2 à leur place ; gabarit-plafond dit dans le devis', async () => {
  const d = new DepotMemoire();
  const c = conceptionAE0414();
  c.parcelle = { idu: IDU, geometrie: CONTOUR_REEL_AE0414, surface_m2: null, source: 'cadastre (travail réel)' } as unknown as ConceptionLue['parcelle'];
  d.conceptions.push({ ...c, user_id: USER });
  const r = await executerOutilStudio('studio_preparer_3d', {}, env(d));
  eq(r?.status, 'ok', r?.message);
  const v = r!.data!.volume as Record<string, unknown>;
  eq([v.batiments, v.gabarit, v.niveaux, v.sdp_estimee_m2, v.logements_places], [2, 'R+2', 3, 2808, 40]);
  const f = ficheDepuisPreparation(d.preparations[0], CONV, '2026-11-05T12:00:00.000Z', crypto.randomUUID(), 'https://mimmoza.vercel.app');
  ok(f.ok);
  const charge = f.ok ? f.valeur.charge as { batiments: Array<{ nom: string; niveaux: number; largeurM: number; profondeurM: number; rotationDeg: number }>; programme: { commandeArchitecture: string | null; brief: string }; extensionsV1: { implantation: unknown } } : null;
  // Mêmes données que la charge reçue par le worker (charge.json du travail 2825784c) : brief et commande du 1er bâtiment…
  ok(charge!.programme.brief.includes('ensemble de 2 volumes, 40 unités transmis à Studio'));
  eq(charge!.programme.commandeArchitecture, 'Crée un immeuble R+2 de 29,5 m sur 16 m.');
  // … mais la fiche porte bien LES DEUX bâtiments, à leur place : c'est le worker qui les abandonnait (versChargeV1).
  eq(charge!.batiments.map((b) => [b.nom, b.niveaux, b.largeurM, b.profondeurM, b.rotationDeg]), [
    ['Barre A — 21 logements R+2', 3, 29.5, 16, -120.4], ['Barre B — 19 logements R+2', 3, 29, 16, -120.4]]);
  eq(charge!.extensionsV1.implantation, null);
  const devis = await executerOutilStudio('studio_lancer_rendu', { brief: B, type: 'image' }, env(d));
  const av = (devis!.data!.devis as Record<string, unknown>).avertissements as string[];
  ok(av.some((a) => a.includes('Le gabarit du programme (R+4) est un plafond, pas une cible : le volume préparé, et donc le rendu, est en R+2 (2 bâtiments).')), av.join(' | '));
});

// ═══ E1-rendu : brief d'habillage × plusieurs bâtiments (AE0414 réelle = 2 barres R+2) ═══════════════

const BRIEF_AE0414 = { facade: 'brique', balcons: 'loggias', attique: true, rdc: 'commerces' };

Deno.test('E1-R1 : AE0414 réelle (2 bâtiments) + brief — habillage transmis À CHAQUE bâtiment (fiche.habillage_batiments), géométrie inchangée, devis honnête', async () => {
  const d = new DepotMemoire();
  const c = conceptionAE0414();
  c.parcelle = { idu: IDU, geometrie: CONTOUR_REEL_AE0414, surface_m2: null, source: 'cadastre (travail réel)' } as unknown as ConceptionLue['parcelle'];
  d.conceptions.push({ ...c, user_id: USER });
  eq((await executerOutilStudio('studio_preparer_3d', {}, env(d)))?.status, 'ok');
  const r1 = await executerOutilStudio('studio_lancer_rendu', { type: 'image', brief: BRIEF_AE0414 }, env(d, 'R1'));
  eq(r1?.status, 'confirmation_requise', r1?.message);
  const devis = r1!.data!.devis as Record<string, unknown>;
  ok(/façade brique · fenêtres verticales \(par défaut\) · loggias · avec attique · rez-de-chaussée : commerces/.test(String(devis.habillage)), String(devis.habillage));
  const av = (devis.avertissements as string[]);
  const tout = av.join(' | ');
  ok(av.some((a) => a.startsWith('Ensemble de 2 bâtiments : l’habillage (façade, ouvertures, balcons ou loggias, attique, rez-de-chaussée) est appliqué à chacun des 2 bâtiments')), tout);
  ok(/AU-DESSUS des niveaux du volume d’étude \(retrait de 2 m\), sur chaque bâtiment/.test(tout), tout);
  ok(/chacun est reconstruit à sa place/.test(tout) && /est un plafond, pas une cible/.test(tout), tout);
  // Plus jamais « balcons et style non pris en compte » quand ils sont transmis à chaque bâtiment.
  ok(!/il les poserait sur le seul premier bâtiment/.test(tout), tout);
  d.persister(r1);
  const l = await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env(d, 'R2'));
  eq(l?.status, 'ok', l?.message);
  ok(/carte du chat/.test(String(l?.message)) && /inutile de recopier les liens/.test(String(l?.message)), l?.message);
  const fiche = d.travaux[0].fiche as Record<string, unknown>;
  // Habillage par bâtiment, traduit pour le Studio (worker/src/fiche.ts::lireHabillage).
  eq(fiche.habillage_batiments, {
    clauses: ['façade en brique', 'fenêtres verticales', 'avec attique', 'commerces en rez-de-chaussée'],
    balcons: 'loggia',
  });
  // Géométrie du contrat inchangée par le brief : mêmes 2 barres R+2, même place.
  const charge = fiche.charge as { batiments: Array<{ nom: string; niveaux: number; largeurM: number; profondeurM: number; rotationDeg: number }> };
  eq(charge.batiments.map((b) => [b.nom, b.niveaux, b.largeurM, b.profondeurM, b.rotationDeg]), [
    ['Barre A — 21 logements R+2', 3, 29.5, 16, -120.4], ['Barre B — 19 logements R+2', 3, 29, 16, -120.4]]);
});

Deno.test('E1-R2 : habillage_batiments — seulement pour plusieurs bâtiments ; balcons traduits pour le Studio ; jamais de style ; aucune clause de balcon ni de style', async () => {
  // Un bâtiment (rectangle synthétique) : le brief reste dans la commande, pas d'habillage à part.
  const d = depotAvecConception();
  await preparer(d);
  const f1 = ficheDepuisPreparation(d.preparations[0], CONV, '2026-11-05T12:00:00.000Z', crypto.randomUUID(), 'https://mimmoza.vercel.app', { ...BRIEF_DEFAUT, precisions: null, defauts: [] });
  ok(f1.ok && f1.valeur.habillage_batiments === undefined);
  const b = { ...BRIEF_DEFAUT, precisions: null, defauts: [] };
  eq(habillageBatiments({ ...b, style: 'haussmannien', balcons: 'balcons_filants', facade: 'verre', ouvertures: 'baies_vitrees' }),
    { clauses: ['façade en verre'], balcons: 'running' });
  eq(habillageBatiments({ ...b, style: 'art_deco', balcons: 'aucun' }), { clauses: ['façade en enduit', 'fenêtres verticales'], balcons: null });
  eq(habillageBatiments({ ...b }).balcons, 'individual');
  for (const st of BRIEF_STYLES) for (const bl of BRIEF_BALCONS) {
    ok(!habillageBatiments({ ...b, style: st, balcons: bl, attique: true, rdc: 'commerces' }).clauses.some((c) => /balcon|loggia|style/.test(c)));
  }
  // Réserves : composition nommée (A à H) inchangée ; contrat à 2 bâtiments : appliqué à chacun.
  ok(reservesBrief({ ...b, style: 'art_deco' }, 'preparation', true).some((r) => /balcons non pris en compte/.test(r)));
  const r2 = reservesBrief({ ...b, style: 'art_deco' }, 'preparation', false, 2);
  ok(!r2.some((r) => /il les poserait sur le seul premier bâtiment/.test(r)) && r2.some((r) => /appliqué à chacun des 2 bâtiments/.test(r)), r2.join(' | '));
  // Style haussmannien / Art déco : pack « manifest » du Studio, jamais transmis, dit NON appliqué.
  ok(r2.some((r) => /Style Art déco : prévu dans le Studio mais pas encore disponible/.test(r) && /NON appliqué/.test(r)), r2.join(' | '));
});

Deno.test('E1-R3 : studio_etat_rendu — le message rappelle que la carte du chat affiche suivi et résultat', async () => {
  const d = depotAvecConception();
  await preparer(d);
  const devis = await executerOutilStudio('studio_lancer_rendu', { brief: B, type: 'film' }, env(d, 'rq-1'));
  await executerOutilStudio('studio_lancer_rendu', { confirmer: true, jeton_devis: devis!.data!.jeton_devis }, env(d, 'rq-2'));
  const e = await executerOutilStudio('studio_etat_rendu', {}, env(d));
  ok(/carte du chat/.test(String(e?.message)) && /inutile de recopier les liens ou les images/.test(String(e?.message)), e?.message);
  // La garde du brief (sortie partielle, aucun devis) n'est pas un lancement : pas de consigne de carte.
  const d2 = depotAvecConception();
  await preparer(d2);
  const g = await executerOutilStudio('studio_lancer_rendu', { type: 'film' }, env(d2, 'g-1'));
  eq([g?.status, g?.data?.brief_requis], ['partial', true]);
  ok(!/carte du chat/.test(String(g?.message)));
});

Deno.test('E1-15 : déclarations — outils exposés, mission de conception seulement pour la préparation, jamais de rendu en mission', () => {
  eq(OUTILS_STUDIO_CHAT.map((o) => o.name), ['studio_preparer_3d', 'studio_lancer_rendu', 'studio_etat_rendu']);
  ok(OUTILS_CONCEPTION.some((o) => o.name === 'studio_preparer_3d') && NOMS_OUTILS_MISSION.has('studio_preparer_3d'));
  const chat: OutilDef[] = OUTILS_STUDIO_CHAT;
  const noms = (t: string) => outilsPourMission(t, chat).map((o) => o.name);
  ok(noms('conception').includes('studio_preparer_3d'));
  ok(!noms('prospection_fonciere').some((n) => n.startsWith('studio_')));
  ok(!noms('conception').includes('studio_lancer_rendu') && !noms('conception').includes('studio_etat_rendu'));
  for (const n of ['studio_lancer_rendu', 'studio_etat_rendu', 'studio_preparer_3d']) eq(outilChatAutoriseEnMission(n), false, n);
  const lancer = OUTILS_STUDIO_CHAT[1];
  ok(/DEUX TEMPS/.test(lancer.description) && /tour suivant/.test(lancer.description));
  ok(studioPertinent(['Mimmo, prépare la 3D de ma conception AE0414 puis lance une image']));
  ok(studioPertinent(['oui', 'Voici le devis du rendu : 0 jeton…']));
  ok(!studioPertinent(['Quel est le prix au m² à Nanterre ?', 'Le prix médian est de 5 159 €/m².']));
  // Identifiant de requête : stable pour un même contexte, distinct d'une requête à l'autre.
  const ctx = {};
  eq(idRequete(ctx), idRequete(ctx));
  ok(idRequete({}) !== idRequete({}));
});

Deno.test('E1-16 : jeton — signature HMAC, JSON canonique', async () => {
  const c = { v: 1 as const, id: 'i', u: USER, t: 'film' as const, o: { b: 1, a: 2 }, s: { genre: 'preparation' as const, preparation_id: 'p' }, c: CONV, iat: 1, exp: 2, rq: 'r' };
  const j = await signerJeton(c, 's');
  eq(await lireJeton(j, 's'), JSON.parse(jsonCanonique(c)));
  eq(await lireJeton(j, 't'), null);
  eq(await lireJeton('pas-un-jeton', 's'), null);
});

Deno.test('E1-17 : dépôt Supabase — requêtes filtrées par utilisateur, insertion SOUS JWT, upsert par empreinte', async () => {
  const appels: string[] = [];
  const req = (table: string, client: string) => {
    const q: Record<string, unknown> = {};
    const ch = (nom: string) => (...a: unknown[]) => { appels.push(`${client}:${table}.${nom}(${a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(',')})`); return q; };
    for (const m of ['select', 'eq', 'neq', 'in', 'lt', 'not', 'order', 'limit', 'insert', 'upsert']) q[m] = ch(m);
    q.single = async () => ({ data: { id: 'x', statut: 'en_attente' }, error: null });
    q.then = (r: (v: unknown) => unknown) => r({ data: [], error: null, count: 0 });
    return q;
  };
  const client = (nom: string) => ({ from: (t: string) => req(t, nom), rpc: async () => ({ data: true, error: null }), storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'u' }, error: null }) }) } });
  const dep = depotStudioSupabase(client('admin'), client('jwt'));
  await dep.conception(USER, { idu: IDU });
  await dep.enregistrerPreparation(USER, { conception_id: null, conversation_id: CONV, idu: IDU, empreinte: 'e'.repeat(64), entree: {}, volume: {}, resume: {}, origine: 'chat', version_calcul: 'v' });
  await dep.insererTravail(USER, { conversation_id: CONV, type: 'film', fiche: {}, options: {} });
  await dep.travailParDevis(USER, 'd');
  eq(await dep.jetonsDevis(USER, CONV), []);
  ok(appels.some((a) => a.startsWith('jwt:agent_conceptions.eq(user_id,' + USER)));
  ok(appels.some((a) => a.startsWith('jwt:studio_preparations.upsert(') && a.includes('user_id,empreinte')), appels.join('\n'));
  ok(appels.some((a) => a.startsWith('jwt:studio_jobs.insert(')), 'insertion avec le client utilisateur');
  ok(appels.some((a) => a === 'jwt:studio_jobs.eq(fiche->>devis_id,d)'));
  ok(!appels.some((a) => a.startsWith('admin:studio_jobs.insert')), 'jamais d’insertion en service_role');
  // Devis relus : bornés à l'utilisateur, à la conversation et à l'outil.
  for (const f of [`admin:copilot_tool_calls.eq(user_id,${USER})`, `admin:copilot_tool_calls.eq(conversation_id,${CONV})`, 'admin:copilot_tool_calls.eq(tool_name,studio_lancer_rendu)']) ok(appels.includes(f), f);
  // Sans session (mission) : aucune insertion de travail possible.
  await na.rejects(() => depotStudioSupabase(client('admin'), null).insererTravail(USER, { conversation_id: CONV, type: 'film', fiche: {}, options: {} }));
});

// Garde-fou : la fonction de contrôle ne lit que les règles connues (une règle manquante n'est pas contrôlée).
Deno.test('E1-18 : contrôles sans règles → « non contrôlé », valeurs par défaut dites', async () => {
  const c = { ...conceptionAE0414(), regles_plu: completerRegles([]) };
  const p = await preparerVolume(c);
  ok(p.ok);
  if (!p.ok) return;
  ok(p.resume.controles.every((x) => x.verdict === 'non_controle'), JSON.stringify(p.resume.controles.map((x) => x.verdict)));
  ok(p.resume.controles.find((x) => x.cle === 'emprise_sol_max_pct')!.explication.includes('par défaut'));
  eq(controlerVolume(p.volume, [], null).length, 5);
});

// ═══ 4. E1-brief : une question groupée avant le premier devis, brief porté jusqu'au Studio ══════════

const BRIEF_COMPLET = { style: 'haussmannien', facade: 'brique', ouvertures: 'fenetres_verticales', balcons: 'loggias', attique: true, rdc: 'commerces', ambiance: 'fin_de_journee' };

Deno.test('E1-B1 : 3D préparée sans brief → aucun devis, UNE question groupée lisible avec valeurs proposées', async () => {
  const d = depotAvecConception();
  await preparer(d);
  const r = await executerOutilStudio('studio_lancer_rendu', { type: 'image' }, env(d, 'R1'));
  eq([r?.status, r?.data?.brief_requis, r?.data?.jeton_devis, d.inserts], ['partial', true, undefined, 0]);
  const q = String(r!.data!.question);
  const lignes = q.split('\n');
  ok(lignes.filter((l) => l.startsWith('- ')).length === 6, q);
  for (const mot of ['Style architectural : contemporain', 'Façade et matériaux : enduit clair', 'Balcons / loggias : balcons', 'Attique : non', 'Rez-de-chaussée : logements', 'Ambiance : journée']) ok(q.includes(mot), mot);
  ok(!/\(1\)|\(2\)/.test(q), 'pas de liste (1)…(2)… en ligne');
  ok(/à toi de choisir/.test(q) && /UN SEUL message/.test(r!.message!) && /Ne repose JAMAIS/.test(r!.message!));
  const champs = r!.data!.champs as Record<string, { defaut: unknown; valeurs: unknown[] }>;
  eq(Object.fromEntries(Object.entries(champs).filter(([k]) => k !== 'precisions').map(([k, v]) => [k, v.defaut])), { ...BRIEF_DEFAUT });
  eq(champs.ambiance.valeurs, ['jour', 'fin_de_journee'], 'image : pas de nuit proposée');
  ok(questionBrief('film').includes('nuit'));
  // Question déjà posée (sortie enregistrée) : jamais reposée — valeurs par défaut appliquées et dites.
  d.persister(r);
  const r2 = await executerOutilStudio('studio_lancer_rendu', { type: 'image' }, env(d, 'R2'));
  eq(r2?.status, 'confirmation_requise', r2?.message);
  ok(/DÉJÀ été posée/.test(r2!.message!));
  const h = String((r2!.data!.devis as Record<string, unknown>).habillage);
  ok(/style contemporain \(par défaut\)/.test(h) && /façade enduit clair \(beige\) \(par défaut\)/.test(h), h);
});

Deno.test('E1-B2 : « à toi de choisir » → valeurs par défaut, écrites dans le devis et dans le jeton', async () => {
  const d = depotAvecConception();
  await preparer(d);
  const r = await executerOutilStudio('studio_lancer_rendu', { type: 'film', brief: { a_toi_de_choisir: true } }, env(d));
  eq(r?.status, 'confirmation_requise', r?.message);
  const devis = r!.data!.devis as Record<string, unknown>;
  eq(devis.habillage, 'style contemporain (par défaut) · façade enduit clair (beige) (par défaut) · fenêtres verticales (par défaut) · balcons (par défaut) · sans attique (par défaut) · rez-de-chaussée : logements (par défaut) · lumière de journée (par défaut)');
  ok((devis.avertissements as string[]).some((a) => /dessin par défaut/.test(a)), 'style contemporain : sans jeu de style dédié, dit');
  ok(/choisis par Mimmo/.test(r!.message!));
  const c = await lireJeton(r!.data!.jeton_devis, 'secret-de-test');
  eq(c?.b, '0000000.7f');
  eq(briefDuJeton(c?.b), { ...BRIEF_DEFAUT, precisions: null, defauts: ['style', 'facade', 'ouvertures', 'balcons', 'attique', 'rdc', 'ambiance'] });
  // Jeton toujours lisible dans les 900 premiers caractères du rappel.
  const sortie = JSON.stringify(r);
  ok(sortie.indexOf(String(r!.data!.jeton_devis)) + String(r!.data!.jeton_devis).length < 900, String(sortie.indexOf(String(r!.data!.jeton_devis)) + String(r!.data!.jeton_devis).length));
});

Deno.test('E1-B3 : brief dans le jeton et dans la fiche (commande de création du Studio), retrouvé à la confirmation sans jeton', async () => {
  const d = depotAvecConception();
  await preparer(d);
  const r1 = await executerOutilStudio('studio_lancer_rendu', { type: 'film', brief: BRIEF_COMPLET }, env(d, 'R1'));
  eq(r1?.status, 'confirmation_requise', r1?.message);
  const devis = r1!.data!.devis as Record<string, unknown>;
  ok(/style haussmannien · façade brique · fenêtres verticales · loggias · avec attique · rez-de-chaussée : commerces · fin de journée$/.test(String(devis.habillage)), String(devis.habillage));
  const av = (devis.avertissements as string[]).join(' | ');
  ok(/Style haussmannien : prévu dans le Studio mais pas encore disponible/.test(av) && /AU-DESSUS des niveaux du volume/.test(av) && /surface commerciale/.test(av), av);
  // Ambiance du brief → options du rendu (lues par la machine de rendu).
  eq((r1!.data!.options as Record<string, unknown>).ambiance, 'fin_de_journee');
  d.persister(r1);
  // R2 : « go » sans jeton → le serveur retrouve le devis ET son brief.
  const l = await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env(d, 'R2'));
  eq(l?.status, 'ok', l?.message);
  const t = d.travaux[0];
  // Projet v2 : la commande et le brief sont dans `programme` (versChargeV1 les rend au Studio).
  const charge = (t.fiche.charge as { programme: Record<string, unknown> }).programme;
  const commande = String(charge.commandeArchitecture);
  ok(/^Crée un immeuble R\+4 de [\d,]+ m sur [\d,]+ m, façade en brique, fenêtres verticales, avec loggias, avec attique, commerces en rez-de-chaussée\.$/.test(commande), commande);
  // E1-rendu : jamais « style haussmannien » dans la commande (pack non disponible : le Studio ne créerait rien).
  ok(!/style/.test(commande), commande);
  ok(/habillage demandé : style haussmannien/.test(String(charge.brief)), String(charge.brief));
  eq((t.fiche.brief_rendu as Record<string, unknown>).facade, 'brique');
  eq(t.options.ambiance, 'fin_de_journee');
});

Deno.test('E1-B4 : même brief → même devis ; brief différent → nouveau devis ; brief connu repris sans reposer la question', async () => {
  const d = depotAvecConception();
  await preparer(d);
  const r1 = await executerOutilStudio('studio_lancer_rendu', { type: 'visite360', brief: BRIEF_COMPLET }, env(d, 'R1'));
  d.persister(r1);
  const r2 = await executerOutilStudio('studio_lancer_rendu', { type: 'visite360', brief: { ...BRIEF_COMPLET } }, env(d, 'R2'));
  eq([r2?.data?.deja_presente, r2?.data?.jeton_devis], [true, r1!.data!.jeton_devis]);
  const r3 = await executerOutilStudio('studio_lancer_rendu', { type: 'visite360', brief: { ...BRIEF_COMPLET, balcons: 'aucun' } }, env(d, 'R2'));
  eq(r3?.data?.deja_presente, undefined);
  ok(r3!.data!.jeton_devis !== r1!.data!.jeton_devis);
  // Sans brief dans l'appel : celui déjà présenté dans la conversation est repris (aucune question).
  const r4 = await executerOutilStudio('studio_lancer_rendu', { type: 'visite360' }, env(d, 'R3'));
  eq([r4?.status, r4?.data?.deja_presente], ['confirmation_requise', true], r4?.message);
  ok(/façade brique/.test(String((r4!.data!.devis as Record<string, unknown>).habillage)));
});

Deno.test('E1-B5 : validation stricte du brief (valeurs fermées, texte borné)', () => {
  ok(!validerBrief(null).ok && !validerBrief('brique').ok);
  ok(!validerBrief({}).ok, 'vide sans « à toi de choisir »');
  ok(!validerBrief({ style: 'gothique' }).ok);
  ok(!validerBrief({ facade: 'cuivre' }).ok);
  ok(!validerBrief({ attique: 'oui' }).ok);
  ok(!validerBrief({ couleur: 'rouge' }).ok, 'champ inconnu');
  ok(!validerBrief({ a_toi_de_choisir: 'oui' }).ok);
  ok(!validerBrief({ a_toi_de_choisir: true, precisions: 'x'.repeat(101) }).ok);
  ok(!validerBrief({ a_toi_de_choisir: true, precisions: 12 }).ok);
  const v = validerBrief({ facade: 'pierre', precisions: '  volets\n bois \u0007 ' });
  ok(v.ok);
  eq(v.ok && [v.valeur.facade, v.valeur.style, v.valeur.precisions, v.valeur.defauts.includes('facade')], ['pierre', 'contemporain', 'volets bois', false]);
  // Aller-retour compact du jeton.
  if (v.ok) eq(briefDuJeton(encoderBrief(v.valeur)), v.valeur);
  eq(briefDuJeton('9999999.7f'), null);
  eq(briefDuJeton({ style: 'contemporain' }), null);
});

Deno.test('E1-B6 : commande du Studio — jamais « sans attique », pas de balcons ni de style répétés pour une composition', () => {
  const b = { ...BRIEF_DEFAUT, precisions: null, defauts: [] };
  const c = commandeAvecBrief('Crée un immeuble R+4 de 30 m sur 14 m.', b);
  eq(c, 'Crée un immeuble R+4 de 30 m sur 14 m, façade en enduit, fenêtres verticales, avec balcons.');
  ok(!/attique/.test(c!));
  eq(clausesBrief({ ...b, attique: true, balcons: 'balcons_filants', style: 'art_deco' }, true), ['façade en enduit', 'fenêtres verticales', 'avec attique']);
  eq(clausesBrief({ ...b, facade: 'verre', ouvertures: 'baies_vitrees' }), ['façade en verre', 'avec balcons'], 'façade vitrée : baies du Studio');
  eq(commandeAvecBrief(null, b), null);
  eq(commandeAvecBrief('Crée un immeuble.', null), 'Crée un immeuble.');
  // E1-rendu : aucun style transmis, même pour un bâtiment seul (pack « manifest » : création bloquée).
  for (const style of BRIEF_STYLES) ok(!clausesBrief({ ...b, style }).some((x) => /style/.test(x)), style);
});

Deno.test('E1-B7 : version enregistrée → pas de brief exigé ; brief fourni dit « rendue telle quelle » ; image de nuit refusée', async () => {
  const d = depotAvecConception();
  d.versions.push({ user_id: USER, conception_id: CONCEPTION_ID, n: 2, modele_ref: `${USER}/${CONCEPTION_ID}/modele-v2.mstudio.json` });
  const sans = await executerOutilStudio('studio_lancer_rendu', { type: 'film', conception_id: CONCEPTION_ID }, env(d, 'R1'));
  eq(sans?.status, 'confirmation_requise');
  const avec = await executerOutilStudio('studio_lancer_rendu', { type: 'film', conception_id: CONCEPTION_ID, brief: BRIEF_COMPLET }, env(d, 'R1'));
  ok(((avec!.data!.devis as Record<string, unknown>).avertissements as string[]).some((a) => /TELLE QUELLE/.test(a)));
  const d2 = depotAvecConception();
  await preparer(d2);
  const nuit = await executerOutilStudio('studio_lancer_rendu', { type: 'image', brief: { ambiance: 'nuit' } }, env(d2, 'R1'));
  eq(nuit?.status, 'error'); ok(/pas de nuit/.test(nuit!.message!));
  // Options explicites : elles priment, le brief s'aligne.
  const opt = await executerOutilStudio('studio_lancer_rendu', { type: 'film', options: { ambiance: 'nuit' }, brief: { a_toi_de_choisir: true } }, env(d2, 'R1'));
  ok(/nuit$/.test(String((opt!.data!.devis as Record<string, unknown>).habillage)), String((opt!.data!.devis as Record<string, unknown>).habillage));
  const err = await executerOutilStudio('studio_lancer_rendu', { type: 'film', brief: { style: 'gothique' } }, env(d2, 'R1'));
  eq(err?.status, 'error'); eq(d2.inserts, 0);
});


// ═══ BRIEF-CRÉATIF : carte du chat (aperçu du volume, brief structuré lu dans le message) ═══════════

/** Fixture de la carte côté front : sortie RÉELLE de la garde sur AE0414 (vérifiée ici, relue par briefCreatif.test.ts). */
const FIXTURE_DEMANDE = new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/demande-brief-AE0414.json', import.meta.url);

async function depotAE0414Reelle(): Promise<DepotMemoire> {
  const d = new DepotMemoire();
  const c = conceptionAE0414();
  c.parcelle = { idu: IDU, geometrie: CONTOUR_REEL_AE0414, surface_m2: null, source: 'cadastre (travail réel)' } as unknown as ConceptionLue['parcelle'];
  d.conceptions.push({ ...c, user_id: USER });
  eq((await executerOutilStudio('studio_preparer_3d', {}, env(d)))?.status, 'ok');
  return d;
}
/** Message envoyé par « Valider le brief » (même forme que briefCreatif.ts::messageBrief). */
const messageCarte = (bloc: unknown) => `Brief créatif validé pour le film (rendu) : Brique · loggias.\n\n\`\`\`${BRIEF_BLOC_LANGUE}\n${JSON.stringify(bloc)}\n\`\`\``;

Deno.test('BC-1 : garde du brief — carte « brief_creatif », aperçu = volume RÉEL (2 barres AE0414), limites ; fixture front identique', async () => {
  const d = await depotAE0414Reelle();
  const r = await executerOutilStudio('studio_lancer_rendu', { type: 'film' }, env(d, 'R1'));
  eq([r?.status, r?.data?.brief_requis, r?.data?.carte, d.inserts], ['partial', true, 'brief_creatif', 0]);
  const ap = r!.data!.apercu as { corps: Array<{ l: number; p: number; n: number; a: number }>; contour: unknown[] };
  // Mêmes corps que le volume préparé (et que la fiche Studio : 29,5 × 16 et 29 × 16, R+2, rotation −120,4° côté contrat).
  eq(ap.corps.map((k) => [k.l, k.p, k.n]), [[29.5, 16, 3], [29, 16, 3]]);
  ok(ap.corps.every((k) => Math.abs(k.a - 120.4) < 0.11 || Math.abs(k.a + 239.6) < 0.11), JSON.stringify(ap.corps));
  ok(Array.isArray(ap.contour) && ap.contour.length >= 3 && ap.contour.length <= 48);
  eq(r!.data!.limites, { batiments: 2, balcons: true });
  ok(/carte « Brief créatif »/.test(r!.message!) && /UN SEUL message/.test(r!.message!) && /Ne repose JAMAIS/.test(r!.message!) && /ne recopie pas la liste/.test(r!.message!));
  ok(typeof r!.data!.question === 'string', 'question texte conservée (repli)');
  const fixture = JSON.parse(await Deno.readTextFile(FIXTURE_DEMANDE));
  eq(fixture, JSON.parse(JSON.stringify(r)), 'la fixture du front doit être la sortie réelle du serveur');
  eq(apercuVolume(null), null);
  eq(apercuVolume({ emprise: null }), null);
});

Deno.test('BC-2 : brief validé dans la carte — lu par le serveur dans le message (prioritaire sur le modèle), devis avec « Modifier l’habillage »', async () => {
  const d = await depotAE0414Reelle();
  d.persister(await executerOutilStudio('studio_lancer_rendu', { type: 'film' }, env(d, 'R1')));
  const carte = briefDuMessage(messageCarte({ v: 1, type: 'film', brief: { facade: 'brique', balcons: 'loggias', attique: true, rdc: 'commerces', a_toi_de_choisir: true } }));
  ok(carte?.ok);
  // Le modèle recopie mal (béton) et oublie le type : le serveur prend la carte.
  const r = await executerOutilStudio('studio_lancer_rendu', { brief: { facade: 'beton' } }, env(d, 'R2', { briefCarte: carte }));
  eq(r?.status, 'confirmation_requise', r?.message);
  eq(r!.data!.type, 'film');
  const devis = r!.data!.devis as Record<string, unknown>;
  eq(devis.habillage, 'style contemporain (par défaut) · façade brique · fenêtres verticales (par défaut) · loggias · avec attique · rez-de-chaussée : commerces · lumière de journée (par défaut)');
  const ba = r!.data!.brief_actuel as Record<string, unknown>;
  eq([ba.facade, ba.balcons, ba.attique, ba.rdc, ba.defauts], ['brique', 'loggias', true, 'commerces', ['style', 'ouvertures', 'ambiance']]);
  eq((r!.data!.apercu as { corps: unknown[] }).corps.length, 2);
  ok(/carte « Brief créatif »/.test(r!.message!) && /Modifier l’habillage/.test(r!.message!));
  const sortie = JSON.stringify(r);
  const j = String(r!.data!.jeton_devis);
  ok(sortie.indexOf(j) + j.length < 900, 'jeton toujours dans les 900 premiers caractères');
  // Confirmation au message suivant (sans bloc) : la fiche porte l'habillage de la carte, pour chaque bâtiment.
  d.persister(r);
  const l = await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env(d, 'R3'));
  eq(l?.status, 'ok', l?.message);
  eq((d.travaux[0].fiche as Record<string, unknown>).habillage_batiments, {
    clauses: ['façade en brique', 'fenêtres verticales', 'avec attique', 'commerces en rez-de-chaussée'], balcons: 'loggia' });
});

Deno.test('BC-3 : bloc de brief — absent → null ; illisible / hors listes → refus dit, rien de lancé ; consigne système', async () => {
  eq(briefDuMessage('Lance le film'), null);
  eq(briefDuMessage(undefined), null);
  const refus = [
    '```mimmoza-brief\n{pas du json}\n```',
    messageCarte({ v: 2, brief: { facade: 'brique' } }),
    messageCarte({ v: 1, brief: { facade: 'marbre' } }),
    messageCarte({ v: 1, type: 'photo', brief: { facade: 'brique' } }),
    messageCarte({ v: 1, brief: { facade: 'brique' }, prix: 0 }),
    messageCarte({ v: 1, brief: {} }),
  ];
  for (const m of refus) { const v = briefDuMessage(m); ok(v && !v.ok, m); }
  const v = briefDuMessage('x\r\n```mimmoza-brief  \r\n{"v":1,"brief":{"a_toi_de_choisir":true}}\r\n```');
  ok(v?.ok && v.valeur.type === null && v.valeur.brief.defauts.length === 7, JSON.stringify(v));
  const d = await depotAE0414Reelle();
  const r = await executerOutilStudio('studio_lancer_rendu', { type: 'film' }, env(d, 'R1', { briefCarte: briefDuMessage(refus[2]) }));
  eq([r?.status, d.inserts], ['error', 0]);
  ok(/RIEN N’A ÉTÉ LANCÉ/.test(r!.message!) && /refaire ses choix dans la carte/.test(r!.message!));
  eq(consigneBriefCarte(null), '');
  ok(/REFUSÉ/.test(consigneBriefCarte(briefDuMessage(refus[2]))));
  const c = consigneBriefCarte(briefDuMessage(messageCarte({ v: 1, type: 'image', brief: { facade: 'pierre' } })));
  ok(/Rappelle IMMÉDIATEMENT studio_lancer_rendu \(type « image »\)/.test(c) && /façade pierre claire/.test(c) && /ne repose aucune question/.test(c), c);
});

Deno.test('BC-4 : « Modifier l’habillage » — ouvrir_brief rouvre la carte préremplie ; brief modifié → nouveau devis, puis repris sans question', async () => {
  const d = await depotAE0414Reelle();
  const r1 = await executerOutilStudio('studio_lancer_rendu', { type: 'image', brief: { facade: 'pierre', balcons: 'balcons_filants' } }, env(d, 'R1'));
  eq(r1?.status, 'confirmation_requise', r1?.message);
  d.persister(r1);
  const o = await executerOutilStudio('studio_lancer_rendu', { type: 'image', ouvrir_brief: true }, env(d, 'R2'));
  eq([o?.status, o?.data?.brief_requis, o?.data?.modification, d.inserts], ['partial', true, true, 0]);
  const act = o!.data!.actuel as Record<string, unknown>;
  eq([act.facade, act.balcons], ['pierre', 'balcons_filants']);
  ok(/préremplie/.test(o!.message!));
  d.persister(o);
  const carte = briefDuMessage(messageCarte({ v: 1, type: 'image', brief: { facade: 'bardage_bois', balcons: 'aucun', ambiance: 'fin_de_journee' } }));
  const r3 = await executerOutilStudio('studio_lancer_rendu', { type: 'image', ouvrir_brief: true }, env(d, 'R3', { briefCarte: carte }));
  eq(r3?.status, 'confirmation_requise', 'un brief de carte n’ouvre pas une nouvelle carte : il chiffre');
  ok(/façade bardage bois · fenêtres verticales \(par défaut\) · aucun balcon/.test(String((r3!.data!.devis as Record<string, unknown>).habillage)));
  eq((r3!.data!.options as Record<string, unknown>).ambiance, 'fin_de_journee');
  d.persister(r3);
  // Rendu suivant de la même conception, sans brief : le dernier brief (modifié) est repris, aucune question.
  const r4 = await executerOutilStudio('studio_lancer_rendu', { type: 'film' }, env(d, 'R4'));
  eq(r4?.status, 'confirmation_requise', r4?.message);
  ok(/façade bardage bois/.test(String((r4!.data!.devis as Record<string, unknown>).habillage)));
});
