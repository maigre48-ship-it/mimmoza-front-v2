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
  apercuVolume, BRIEF_BLOC_LANGUE, briefDuMessage, consigneBriefCarte, briefDuFil,
  BRIEF_TOITURES, BRIEF_TEINTES, BRIEF_GARDE_CORPS, BRIEF_MENUISERIES, BRIEF_SOUBASSEMENTS, BRIEF_FACADES, TEINTES_PAR_FACADE, detailsHabillage, libelleBrief,
  batimentsAAiles, RAISON_PENTE_AILES,
  type ConceptionLue, type DepotStudio, type EnvStudio, type PreparationLue, type StatsFile, type TravailLu,
} from './studio.ts';
import { calculerVolumeProgramme } from './studio-front.ts';
import { controlerVolume as controlerVolumeFront } from '../../../../src/spaces/copilot/studio3d/controlesVolume.ts';
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
  /** Lot fiche-3d : messages utilisateur simulés (copilot_messages), du plus ancien au plus récent. */
  messagesUtilisateur: Array<{ user_id: string; conversation_id: string; texte: string; cree_le: string }> = [];
  async briefsMessages(u: string, c: string) {
    return this.messagesUtilisateur.filter((m) => m.user_id === u && m.conversation_id === c && m.texte.includes('```mimmoza-brief'))
      .reverse().map((m) => ({ texte: m.texte, cree_le: m.cree_le }));
  }
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
  // Lot brief-unifié : la liste de l'habillage appliqué à chaque bâtiment compte les détails.
  ok(av.some((a) => a.startsWith('Ensemble de 2 bâtiments : l’habillage (façade, ouvertures, balcons ou loggias, attique, rez-de-chaussée, toiture, garde-corps, menuiseries, soubassement) est appliqué à chacun des 2 bâtiments')), tout);
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
    // Lot brief-unifié : garde-corps toujours transmis avec des balcons (métal par défaut).
    details: { gardeCorps: 'metal' },
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
  // Lot brief-unifié : pour un bâtiment seul, seuls les DÉTAILS voyagent à part (clauses et balcons restent dans la commande).
  const f1 = ficheDepuisPreparation(d.preparations[0], CONV, '2026-11-05T12:00:00.000Z', crypto.randomUUID(), 'https://mimmoza.vercel.app', { ...BRIEF_DEFAUT, precisions: null, defauts: [] });
  ok(f1.ok);
  if (f1.ok) eq(f1.valeur.habillage_batiments, { clauses: [], balcons: null, details: { gardeCorps: 'metal' } });
  const f0 = ficheDepuisPreparation(d.preparations[0], CONV, '2026-11-05T12:00:00.000Z', crypto.randomUUID(), 'https://mimmoza.vercel.app', { ...BRIEF_DEFAUT, balcons: 'aucun', precisions: null, defauts: [] });
  ok(f0.ok && f0.valeur.habillage_batiments === undefined, 'rien à poser : pas d’habillage à part');
  const b = { ...BRIEF_DEFAUT, precisions: null, defauts: [] };
  eq(habillageBatiments({ ...b, style: 'haussmannien', balcons: 'balcons_filants', facade: 'verre', ouvertures: 'baies_vitrees' }),
    { clauses: ['façade en verre'], balcons: 'running', details: { gardeCorps: 'metal' } });
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
  ok(lignes.filter((l) => l.startsWith('- ')).length === 7, q); // lot brief-unifié : + « Détails (facultatif) »
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
  eq(c?.b, '2:000000000000.fff'); // lot brief-unifié : forme « 2: », 12 champs
  eq(briefDuJeton(c?.b), { ...BRIEF_DEFAUT, precisions: null, defauts: ['style', 'facade', 'ouvertures', 'balcons', 'attique', 'rdc', 'ambiance', 'toiture', 'teinte', 'garde_corps', 'menuiseries', 'soubassement'] });
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
  eq(r!.data!.limites, { batiments: 2, balcons: true, ailes: false });
  ok(/carte « Brief créatif »/.test(r!.message!) && /UN SEUL message/.test(r!.message!) && /Ne repose JAMAIS/.test(r!.message!) && /ne recopie pas la liste/.test(r!.message!));
  ok(typeof r!.data!.question === 'string', 'question texte conservée (repli)');
  // Régénération (lot brief-unifié) : ECRIRE_FIXTURE=1 deno test … réécrit la fixture depuis la sortie réelle.
  if (Deno.env.get('ECRIRE_FIXTURE') === '1') await Deno.writeTextFile(FIXTURE_DEMANDE, JSON.stringify(r, null, 2) + '\n');
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
  eq([ba.facade, ba.balcons, ba.attique, ba.rdc, ba.defauts], ['brique', 'loggias', true, 'commerces', ['style', 'ouvertures', 'ambiance', 'toiture', 'teinte', 'garde_corps', 'menuiseries', 'soubassement']]);
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
    clauses: ['façade en brique', 'fenêtres verticales', 'avec attique', 'commerces en rez-de-chaussée'], balcons: 'loggia', details: { gardeCorps: 'metal' } });
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
  ok(v?.ok && v.valeur.type === null && v.valeur.brief.defauts.length === 12, JSON.stringify(v));
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

// ═══ Lot fiche-3d : habillage choisi dans la fiche « Espace 3D » (bloc sans type de rendu) ═══════════

const messageFiche = (brief: Record<string, unknown>) => `Habillage du projet choisi dans la fiche : Brique · loggias.\n\n\`\`\`${BRIEF_BLOC_LANGUE}\n${JSON.stringify({ v: 1, brief })}\n\`\`\``;

Deno.test('FICHE-1 : vérifications PLU — controlerVolume du serveur EST celui du front (controlesVolume.ts), mêmes verdicts AE0414', async () => {
  const { controlerVolume } = await import('./studio.ts');
  ok(controlerVolume === controlerVolumeFront, 'une seule implémentation');
  const d = await depotAE0414Reelle();
  const resume = d.preparations[0].resume as { controles: Array<{ cle: string; verdict: string }> };
  eq(resume.controles.map((c) => [c.cle, c.verdict]), [
    ['hauteur_max_m', 'a_verifier'], ['emprise_sol_max_pct', 'dans_la_limite'], ['recul_voie_m', 'dans_la_limite'],
    ['recul_limites_m', 'dans_la_limite'], ['pleine_terre_min_pct', 'a_verifier'], ['stationnement_par_logement', 'non_controle']]);
  ok(!JSON.stringify(resume.controles).toLowerCase().includes('conforme'));
});

Deno.test('FICHE-2 : bloc de brief SANS type (fiche) — consigne : pas de rendu ni de devis ; bloc typé (carte) inchangé', () => {
  const sans = briefDuMessage(messageFiche({ facade: 'brique', balcons: 'loggias', a_toi_de_choisir: true }));
  ok(sans?.ok && sans.valeur.type === null);
  const c = consigneBriefCarte(sans);
  ok(/HABILLAGE CHOISI dans la fiche/.test(c) && /N’appelle PAS studio_lancer_rendu/.test(c) && /façade brique/.test(c), c);
  ok(!/Rappelle IMMÉDIATEMENT/.test(c));
  const avec = consigneBriefCarte(briefDuMessage(messageCarte({ v: 1, type: 'film', brief: { facade: 'brique' } })));
  ok(/Rappelle IMMÉDIATEMENT studio_lancer_rendu \(type « film »\)/.test(avec), avec);
});

Deno.test('FICHE-3 : brief choisi dans la fiche puis rendu demandé — repris sans question ; ouvrir_brief préremplit la carte avec lui', async () => {
  const d = await depotAE0414Reelle();
  d.messagesUtilisateur.push({ user_id: USER, conversation_id: CONV, texte: messageFiche({ facade: 'brique', balcons: 'loggias', attique: true }), cree_le: new Date(Date.now() - 60_000).toISOString() });
  d.messagesUtilisateur.push({ user_id: AUTRE, conversation_id: CONV, texte: messageFiche({ facade: 'verre' }), cree_le: new Date().toISOString() });
  const lu = await briefDuFil(d, USER, CONV);
  eq([lu?.brief.facade, lu?.brief.balcons, lu?.brief.attique], ['brique', 'loggias', true]);
  const r = await executerOutilStudio('studio_lancer_rendu', { type: 'film' }, env(d, 'F1'));
  eq(r?.status, 'confirmation_requise', 'pas de question : le brief de la fiche est connu');
  ok(/façade brique · fenêtres verticales \(par défaut\) · loggias · avec attique/.test(String((r!.data!.devis as Record<string, unknown>).habillage)), String((r!.data!.devis as Record<string, unknown>).habillage));
  d.persister(r);
  const o = await executerOutilStudio('studio_lancer_rendu', { type: 'film', ouvrir_brief: true }, env(d, 'F2'));
  const act = o!.data!.actuel as Record<string, unknown>;
  eq([o?.status, act.facade, act.balcons, act.attique], ['partial', 'brique', 'loggias', true]);
});

Deno.test('FICHE-4 : le plus récent gagne — devis APRÈS le choix de la fiche : brief du devis ; nouveau choix de fiche APRÈS : brief de la fiche', async () => {
  const d = await depotAE0414Reelle();
  d.messagesUtilisateur.push({ user_id: USER, conversation_id: CONV, texte: messageFiche({ facade: 'pierre' }), cree_le: new Date(Date.now() - 3_600_000).toISOString() });
  const r1 = await executerOutilStudio('studio_lancer_rendu', { type: 'image', brief: { facade: 'beton' } }, env(d, 'G1'));
  eq(r1?.status, 'confirmation_requise');
  d.persister(r1);
  const r2 = await executerOutilStudio('studio_lancer_rendu', { type: 'film' }, env(d, 'G2'));
  ok(/façade béton brut/.test(String((r2!.data!.devis as Record<string, unknown>).habillage)), 'devis plus récent que la fiche');
  d.messagesUtilisateur.push({ user_id: USER, conversation_id: CONV, texte: messageFiche({ facade: 'bardage_bois' }), cree_le: new Date(Date.now() + 60_000).toISOString() });
  const r3 = await executerOutilStudio('studio_lancer_rendu', { type: 'film' }, env(d, 'G3'));
  ok(/façade bardage bois/.test(String((r3!.data!.devis as Record<string, unknown>).habillage)), 'fiche plus récente que le devis');
  // Bloc refusé (valeur hors liste) : ignoré, jamais deviné.
  d.messagesUtilisateur.push({ user_id: USER, conversation_id: CONV, texte: messageFiche({ facade: 'marbre' }), cree_le: new Date(Date.now() + 120_000).toISOString() });
  eq((await briefDuFil(d, USER, CONV))?.brief.facade, 'bardage_bois');
});

// ═══ Lot choix-cliquables (06/11/2026) : la question d'habillage n'est jamais posée par le modèle ═══════════

Deno.test('CC-1 : studio_preparer_3d interdit la question d’habillage et renvoie vers studio_lancer_rendu ; l’appel direct sans brief donne la carte', async () => {
  const d = await depotAE0414Reelle();
  const r = await executerOutilStudio('studio_preparer_3d', {}, env(d, 'R1'));
  eq(r?.status, 'ok', r?.message);
  const m = String(r?.message);
  ok(/ne pose JAMAIS toi-même la question d’habillage/.test(m), m);
  ok(/ni en texte ni en bloc ```mimmoza-choix```/.test(m));
  ok(/appelle MAINTENANT studio_lancer_rendu \(sans `brief`/.test(m));
  ok(/carte « Brief créatif »/.test(m));
  ok(!/Tu peux proposer un rendu \(film, visite 360°, image\) : studio_lancer_rendu affichera d’abord un devis/.test(m), 'ancienne phrase retirée');
  // L'appel que le modèle doit faire (ou que le serveur impose) : sans brief → carte, rien de lancé ni chiffré.
  const c = await executerOutilStudio('studio_lancer_rendu', { type: 'film' }, env(d, 'R1'));
  eq([c?.status, c?.data?.brief_requis, c?.data?.carte, d.inserts], ['partial', true, 'brief_creatif', 0]);
});

// ═══ Lot formes-batiment (06/11/2026) : formes du bâtiment calculées, vérifiées, transmises aile par aile ══════

Deno.test('FB-1 : studio_preparer_3d — forme demandée (« en L ») : volume à ailes enregistré, classement du moteur, verdicts honnêtes', async () => {
  const d = await depotAE0414Reelle();
  const base = d.preparations[0];
  const r = await executerOutilStudio('studio_preparer_3d', { forme: 'l' }, env(d, 'FB1'));
  eq(r?.status, 'ok', r?.message);
  eq(d.preparations.length, 2, 'autre forme → autre empreinte → autre ligne');
  ok(d.preparations[1].empreinte !== base.empreinte);
  const v = d.preparations[1].volume as { batiments: Array<{ nom: string; formeAiles: string; ailes: Array<{ lu: number; lv: number; niveaux: number }> }>; reculM: number; sdpM2: number };
  eq(v.batiments.length, 1);
  eq([v.batiments[0].nom, v.batiments[0].formeAiles], ['Immeuble en L — 40 logements R+2', 'l']);
  eq(v.batiments[0].ailes.map((a) => [a.lu, a.lv, a.niveaux]), [[32, 16, 3], [16, 26.5, 3]]);
  ok(v.reculM >= 7.99 && v.sdpM2 === 2808, JSON.stringify([v.reculM, v.sdpM2]));
  eq([r!.data!.forme_retenue, r!.data!.origine_forme], ['En L', 'demande']);
  const cmp = r!.data!.formes_comparees as Array<{ forme: string; logements: number }>;
  eq(cmp.length, 8);
  eq(cmp[0].forme, 'l');
  const res = r!.data!.volume as { formes: string[]; controles: Array<{ cle: string; verdict: string; explication: string }> };
  eq(res.formes, ['immeuble en L']);
  const lim = res.controles.find((c) => c.cle === 'recul_limites_m')!;
  eq(lim.verdict, 'dans_la_limite');
  ok(/aile par aile/.test(lim.explication));
  eq(res.controles.find((c) => c.cle === 'hauteur_max_m')?.verdict, 'a_verifier');
  ok(!/conforme\b/i.test(JSON.stringify(r?.data)), "jamais « conforme » dans les données");
  ok(/formes_comparees/.test(String(r?.message)) && /SUGGESTION/.test(String(r?.message)));
  // « auto » : la forme en tête du classement.
  const a = await executerOutilStudio('studio_preparer_3d', { forme: 'auto' }, env(d, 'FB1b'));
  eq([a?.data?.forme_retenue, a?.data?.origine_forme], ['En L', 'suggestion']);
  // Sans forme : empreinte et volume d'avant ce lot (même ligne que la préparation de base).
  const s = await executerOutilStudio('studio_preparer_3d', {}, env(d, 'FB1c'));
  eq(s?.data?.preparation_id, base.id);
  eq(s?.data?.origine_forme, 'moteur');
});

Deno.test('FB-2 : rendu d’une préparation à ailes — fiche du Studio : UN bâtiment avec ses ailes (contrat v2), habillage transmis', async () => {
  const d = await depotAE0414Reelle();
  eq((await executerOutilStudio('studio_preparer_3d', { forme: 'cour' }, env(d, 'FB2')))?.status, 'ok');
  const prep = d.preparations[d.preparations.length - 1];
  const f = ficheDepuisPreparation(prep, CONV, '2026-11-06T12:00:00.000Z', crypto.randomUUID(), 'https://mimmoza.vercel.app', { ...BRIEF_DEFAUT, precisions: null, defauts: [] });
  ok(f.ok, f.ok ? '' : f.erreur);
  if (!f.ok) return;
  const charge = f.valeur.charge as { batiments: Array<{ nom: string; ailes: Array<{ largeurM: number; profondeurM: number; x: number; y: number }>; emprise: unknown[] }>; extensionsV1: { implantation: unknown } };
  eq(charge.batiments.length, 1);
  eq(charge.batiments[0].ailes.length, 4);
  eq(charge.batiments[0].emprise.length, 1);
  eq(charge.extensionsV1.implantation, null, 'pas de pose unique : le bâtiment porte sa position');
  ok(f.valeur.habillage_batiments, 'habillage transmis au bâtiment à ailes');
  // Aperçu du brief : une boîte par aile, côtés accolés marqués.
  const ap = apercuVolume(prep.volume)!;
  eq(ap.corps.length, 4);
  eq(ap.corps.map((c) => (c as { int?: number[] }).int ?? []), [[], [0, 1], [], [0, 1]]);
});

Deno.test('FB-3 : forme choisie dans la fiche (bloc ```mimmoza-forme```) — relue, RECALCULÉE par le serveur ; refus et débord dits', async () => {
  const { formeDuMessage, consigneFormeCarte } = await import('./studio.ts');
  const { appliquerForme, blocForme, evaluerSaisie, messageForme, modifierAile, saisieDepuisVolume } = await import('../../../../src/spaces/copilot/studio3d/ficheDimensions.ts');
  const d = await depotAE0414Reelle();
  const p0 = d.preparations[0];
  const pf = { idu: IDU, commune: 'Nanterre', volume: p0.volume as never, regles: lireRegles((p0.entree as { regles: unknown }).regles), programme: (p0.entree as { programme_volume: never }).programme_volume, gabaritNiveaux: 5 };
  // L'utilisateur choisit un U puis met les retours en R+4 dans la fiche.
  const s = modifierAile(modifierAile(appliquerForme(pf, saisieDepuisVolume(pf.volume), 'u'), 0, 1, 'niveaux', 5), 0, 2, 'niveaux', 5);
  const ev = evaluerSaisie(pf, s);
  const msg = messageForme(s, ev)!;
  const carte = formeDuMessage(msg);
  ok(carte?.ok);
  ok(/appelle MAINTENANT studio_preparer_3d/.test(consigneFormeCarte(carte)));
  const r = await executerOutilStudio('studio_preparer_3d', {}, env(d, 'FB3', { formeCarte: carte }));
  eq(r?.status, 'ok', r?.message);
  eq(r?.data?.origine_forme, 'fiche');
  const v = d.preparations[d.preparations.length - 1].volume as { batiments: Array<{ ailes: Array<{ niveaux: number }> }>; sdpM2: number };
  eq(v.batiments[0].ailes.map((a) => a.niveaux), [3, 5, 5]);
  eq(v.sdpM2, ev.sdpM2, 'le serveur trouve les mêmes chiffres que la fiche (même moteur)');
  // Bloc refusé : erreur dite, rien d'enregistré.
  const avant = d.preparations.length;
  const refus = formeDuMessage('```mimmoza-forme\n{"v":1,"forme":"t","corps":[]}\n```');
  eq(refus?.ok, false);
  ok(/REFUSÉ/.test(consigneFormeCarte(refus)));
  eq((await executerOutilStudio('studio_preparer_3d', {}, env(d, 'FB3b', { formeCarte: refus })))?.status, 'partial');
  // Forme qui déborde (aile de 80 m) : refusée par le serveur, jamais enregistrée.
  const geante = blocForme(modifierAile(appliquerForme(pf, saisieDepuisVolume(pf.volume), 'l'), 0, 0, 'longueurM', 80))!;
  const rd = await executerOutilStudio('studio_preparer_3d', {}, env(d, 'FB3c', { formeCarte: formeDuMessage('```mimmoza-forme\n' + JSON.stringify(geante) + '\n```') }));
  eq(rd?.status, 'partial');
  ok(/ne tient pas dans la parcelle/.test(String(rd?.message)), String(rd?.message));
  eq(d.preparations.length, avant);
  eq(formeDuMessage('aucun bloc'), null);
});

Deno.test('FB-4 : mission — résultat compact (< 3 000 caractères) avec la seule suggestion de forme', async () => {
  const dm = new DepotMemoire();
  const c = conceptionAE0414();
  c.parcelle = { idu: IDU, geometrie: CONTOUR_REEL_AE0414, surface_m2: null, source: 'cadastre (travail réel)' } as unknown as ConceptionLue['parcelle'];
  const rm = await executerOutilStudio('studio_preparer_3d', {}, { ...env(dm), secret: null, mission: true, conception: c });
  eq(rm?.status, 'ok');
  ok(JSON.stringify(rm).length < 3000, String(JSON.stringify(rm).length));
  eq(rm?.data?.forme_suggeree, 'En L');
  eq(rm?.data?.formes_comparees, undefined);
});

// ═══ Lot brief-unifié (06/11/2026) : détails du brief — toiture, teinte, garde-corps, menuiseries, soubassement ═══
// Chaque valeur acceptée est rendue par le Studio (vérifié sur le vrai magasin du Studio, voir CHOIX.md du lot) ;
// les clauses ci-dessous sont EXACTEMENT celles essayées le 06/11 (worker/tests/worker/briefUnifie.test.ts).

const BD = { ...BRIEF_DEFAUT, precisions: null, defauts: [] as never[] };

Deno.test('BU-1 : validation — listes fermées ; teinte selon la matière ; pas d’attique sous un toit à deux pans ; pas de soubassement avec des commerces', () => {
  for (const toiture of BRIEF_TOITURES) ok(validerBrief({ toiture }).ok, toiture);
  for (const garde_corps of BRIEF_GARDE_CORPS) ok(validerBrief({ garde_corps }).ok, garde_corps);
  for (const menuiseries of BRIEF_MENUISERIES) ok(validerBrief({ menuiseries }).ok, menuiseries);
  for (const soubassement of BRIEF_SOUBASSEMENTS) ok(validerBrief({ soubassement }).ok, soubassement);
  for (const facade of BRIEF_FACADES) for (const teinte of BRIEF_TEINTES) {
    eq(validerBrief({ facade, teinte }).ok, TEINTES_PAR_FACADE[facade].includes(teinte), `${facade} ${teinte}`);
  }
  for (const [champ, v] of [['toiture', 'mansarde'], ['garde_corps', 'fonte'], ['menuiseries', 'bois'], ['soubassement', 'granit'], ['teinte', 'ocre'], ['entree', 'porche'], ['occultations', 'volets']]) {
    ok(!validerBrief({ [champ]: v }).ok, `${champ} ${v} refusé`);
  }
  ok(!validerBrief({ toiture: 'deux_pans_tuiles', attique: true }).ok, 'attique + deux pans demandés ensemble : refusé et dit');
  const v1 = validerBrief({ toiture: 'deux_pans_zinc', a_toi_de_choisir: true });
  ok(v1.ok && v1.valeur.attique === false && v1.valeur.toiture === 'deux_pans_zinc');
  ok(!validerBrief({ rdc: 'commerces', soubassement: 'pierre' }).ok, 'commerces + soubassement demandés ensemble : refusé');
  const v2 = validerBrief({ facade: 'brique', teinte: 'claire', garde_corps: 'verre', menuiseries: 'anthracite', soubassement: 'pierre' });
  ok(v2.ok);
  if (v2.ok) eq(v2.valeur.defauts, ['style', 'ouvertures', 'balcons', 'attique', 'rdc', 'ambiance', 'toiture']);
});

Deno.test('BU-2 : jeton compact « 2: » — aller-retour exact sur toutes les valeurs ; ancien jeton (7 chiffres) toujours relu', () => {
  for (const toiture of BRIEF_TOITURES) for (const garde_corps of BRIEF_GARDE_CORPS) for (const menuiseries of BRIEF_MENUISERIES) {
    for (const [facade, teintes] of Object.entries(TEINTES_PAR_FACADE)) for (const teinte of teintes) {
      const v = validerBrief({ facade, teinte, toiture, garde_corps, menuiseries, soubassement: 'beton', precisions: 'Brique · test' });
      ok(v.ok, `${facade} ${teinte} ${toiture}`);
      if (v.ok) eq(briefDuJeton(encoderBrief(v.valeur)), v.valeur);
    }
  }
  // Devis émis avant le lot (valables 2 h) : relus, les 5 nouveaux champs à leur valeur par défaut, dits « par défaut ».
  const ancien = briefDuJeton('0201000.7d');
  ok(ancien !== null);
  eq([ancien?.facade, ancien?.balcons, ancien?.toiture, ancien?.teinte, ancien?.garde_corps, ancien?.menuiseries, ancien?.soubassement],
    ['brique', 'balcons_filants', 'terrasse', 'naturelle', 'metal', 'gris', 'aucun']);
  ok(['toiture', 'teinte', 'garde_corps', 'menuiseries', 'soubassement'].every((c) => ancien!.defauts.includes(c as never)));
  eq(briefDuJeton('2:0000000000z0.fff'), null, 'rang hors liste');
  eq(briefDuJeton('2:000000000000'), null);
});

Deno.test('BU-3 : clauses de création (toiture, teinte) = formulations vérifiées sur le Studio ; détails traduits en valeurs du Studio', () => {
  const cl = (x: Partial<typeof BD>) => clausesBrief({ ...BD, ...x });
  eq(cl({ facade: 'brique', teinte: 'claire' })[0], 'façade en brique claire');
  eq(cl({ facade: 'beton', teinte: 'claire' })[0], 'façade en béton blanc');
  eq(cl({ facade: 'bardage_bois', teinte: 'foncee' })[0], 'façade en bois brûlé');
  eq(cl({ facade: 'brique' })[0], 'façade en brique');
  ok(cl({ toiture: 'vegetalisee' }).includes('toiture végétalisée'));
  ok(cl({ toiture: 'deux_pans_tuiles' }).includes('toiture à deux pans en tuiles'));
  ok(cl({ toiture: 'deux_pans_ardoise' }).includes('toiture à deux pans en ardoise'));
  ok(cl({ toiture: 'deux_pans_zinc' }).includes('toiture à deux pans en zinc'));
  ok(!cl({}).some((c) => /toit/.test(c)), 'toit-terrasse : dessin par défaut, aucune clause');
  // Aucune clause ne porte de chiffre, de ponctuation, de balcon ni de style (worker/src/fiche.ts::lireHabillage).
  for (const toiture of BRIEF_TOITURES) for (const [facade, teintes] of Object.entries(TEINTES_PAR_FACADE)) for (const teinte of teintes) {
    for (const c of habillageBatiments({ ...BD, facade: facade as never, teinte, toiture, attique: toiture === 'terrasse', rdc: 'commerces' }).clauses) {
      ok(/^[\p{L} '’-]+$/u.test(c) && !/balcon|loggia|style/i.test(c) && c.length <= 60, c);
    }
  }
  eq(detailsHabillage({ ...BD }), { gardeCorps: 'metal' });
  eq(detailsHabillage({ ...BD, balcons: 'aucun' }), null);
  eq(detailsHabillage({ ...BD, garde_corps: 'verre', menuiseries: 'anthracite', soubassement: 'pierre' }), { gardeCorps: 'glass', menuiseries: 'av-aluminium-noir', soubassement: 'pierre-claire-contemp' });
  eq(detailsHabillage({ ...BD, balcons: 'loggias', garde_corps: 'plein', menuiseries: 'bronze', soubassement: 'brique' }), { gardeCorps: 'solid', menuiseries: 'av-aluminium-bronze', soubassement: 'brique-rouge' });
  eq(detailsHabillage({ ...BD, balcons: 'aucun', menuiseries: 'blanc', soubassement: 'beton' }), { menuiseries: 'av-aluminium-blanc', soubassement: 'beton-brut' });
});

Deno.test('BU-4 : libellé et réserves — détails écrits seulement s’ils changent le dessin par défaut ; toit à deux pans et soubassement dits honnêtement', () => {
  eq(libelleBrief({ ...BD }), 'style contemporain · façade enduit clair (beige) · fenêtres verticales · balcons · sans attique · rez-de-chaussée : logements · lumière de journée');
  const l = libelleBrief({ ...BD, facade: 'brique', teinte: 'claire', toiture: 'vegetalisee', garde_corps: 'verre', menuiseries: 'anthracite', soubassement: 'pierre' });
  ok(l.includes('façade brique claire') && l.includes('toiture végétalisée') && l.includes('garde-corps en verre') && l.includes('menuiseries anthracite') && l.includes('soubassement en pierre'), l);
  ok(!libelleBrief({ ...BD, balcons: 'aucun', garde_corps: 'verre' }).includes('garde-corps'), 'sans balcon : pas de garde-corps annoncé');
  const r = reservesBrief({ ...BD, toiture: 'deux_pans_tuiles', soubassement: 'beton', facade: 'brique', teinte: 'claire' }, 'preparation', false, 2);
  ok(r.some((x) => /Toit à deux pans/.test(x) && /AU-DESSUS du dernier niveau/.test(x) && /sur chaque bâtiment/.test(x) && /PLU/.test(x)), r.join(' | '));
  ok(r.some((x) => /Soubassement : bandeau de 60 cm/.test(x)), r.join(' | '));
  ok(r.some((x) => /Brique claire : matière dessinée par le Studio/.test(x)), r.join(' | '));
  ok(questionBrief('film').includes('Détails (facultatif)'));
});

Deno.test('BU-5 : AE0414 réelle (2 barres) — brief complet validé dans l’Espace 3D → habillage_batiments exact (clauses + balcons + détails), géométrie inchangée', async () => {
  const d = await depotAE0414Reelle();
  d.persister(await executerOutilStudio('studio_lancer_rendu', { type: 'image' }, env(d, 'R1')));
  const brief = { facade: 'brique', teinte: 'claire', balcons: 'loggias', attique: true, toiture: 'vegetalisee', garde_corps: 'verre', menuiseries: 'anthracite', soubassement: 'pierre' };
  const carte = briefDuMessage(`Brief créatif validé pour l’image (rendu) : Brique claire.\n\n\`\`\`${BRIEF_BLOC_LANGUE}\n${JSON.stringify({ v: 1, type: 'image', brief: { ...brief, a_toi_de_choisir: true } })}\n\`\`\``);
  ok(carte?.ok, JSON.stringify(carte));
  const r = await executerOutilStudio('studio_lancer_rendu', {}, env(d, 'R2', { briefCarte: carte }));
  eq(r?.status, 'confirmation_requise', r?.message);
  const devis = r!.data!.devis as Record<string, unknown>;
  ok(/façade brique claire · fenêtres verticales \(par défaut\) · loggias · avec attique/.test(String(devis.habillage)) && /toiture végétalisée · garde-corps en verre · menuiseries anthracite · soubassement en pierre/.test(String(devis.habillage)), String(devis.habillage));
  const j = String(r!.data!.jeton_devis);
  ok(JSON.stringify(r).indexOf(j) + j.length < 900, 'jeton toujours dans les 900 premiers caractères');
  d.persister(r);
  const l = await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env(d, 'R3'));
  eq(l?.status, 'ok', l?.message);
  const fiche = d.travaux[0].fiche as Record<string, unknown>;
  eq(fiche.habillage_batiments, {
    clauses: ['façade en brique claire', 'fenêtres verticales', 'avec attique', 'toiture végétalisée'],
    balcons: 'loggia',
    details: { gardeCorps: 'glass', menuiseries: 'av-aluminium-noir', soubassement: 'pierre-claire-contemp' },
  });
  const charge = fiche.charge as { batiments: Array<{ nom: string; niveaux: number; largeurM: number; profondeurM: number; rotationDeg: number }> };
  eq(charge.batiments.map((b) => [b.nom, b.niveaux, b.largeurM, b.profondeurM, b.rotationDeg]), [
    ['Barre A — 21 logements R+2', 3, 29.5, 16, -120.4], ['Barre B — 19 logements R+2', 3, 29, 16, -120.4]]);
  // Fixture du worker (tests/worker/fixtures/fiche-AE0414-reelle-brief-unifie.json) : la fiche RÉELLE produite par ce code.
  const sortie = Deno.env.get('ECRIRE_FIXTURE_WORKER');
  if (sortie) await Deno.writeTextFile(`${sortie}/fiche-AE0414-reelle-brief-unifie.json`, JSON.stringify(fiche, null, 2) + '\n');
});

Deno.test('BU-6 : bâtiment seul — toiture dans la commande de création ; détails à part (garde-corps métal malgré « baies vitrées »)', async () => {
  const d = depotAvecConception();
  await preparer(d);
  const r = await executerOutilStudio('studio_lancer_rendu', { type: 'film', brief: { facade: 'beton', teinte: 'claire', ouvertures: 'baies_vitrees', toiture: 'deux_pans_ardoise', menuiseries: 'blanc', soubassement: 'brique' } }, env(d, 'R1'));
  eq(r?.status, 'confirmation_requise', r?.message);
  d.persister(r);
  const l = await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env(d, 'R2'));
  eq(l?.status, 'ok', l?.message);
  const fiche = d.travaux[0].fiche as Record<string, unknown>;
  const commande = String(((fiche.charge as Record<string, unknown>).extensionsV1 as Record<string, unknown> | undefined)?.commandeArchitecture ?? JSON.stringify(fiche.charge));
  ok(/façade en béton blanc, baies vitrées, avec balcons, toiture à deux pans en ardoise/.test(commande), commande);
  eq(fiche.habillage_batiments, { clauses: [], balcons: null, details: { gardeCorps: 'metal', menuiseries: 'av-aluminium-blanc', soubassement: 'brique-rouge' } });
  const sortie = Deno.env.get('ECRIRE_FIXTURE_WORKER');
  if (sortie) await Deno.writeTextFile(`${sortie}/fiche-AE0414-synthetique-brief-unifie.json`, JSON.stringify(fiche, null, 2) + '\n');
});

// ═══ Lot brief-formes (06/11/2026) : fusion des lots brief-unifié et formes-batiment ══════════════════════════
// L'habillage complet part au worker pour un bâtiment À AILES (une seule entrée `batiments` avec ses ailes) : le
// worker l'applique au bâtiment multi_wing, donc à chaque aile (tests/worker/briefFormes.test.ts). Toit à deux
// pans : jamais promis sur un bâtiment à ailes (le Studio couvrirait chaque aile d'un toit séparé, sans noue).

const BRIEF_RICHE = { facade: 'brique', teinte: 'claire', balcons: 'loggias', attique: true, toiture: 'vegetalisee', garde_corps: 'verre', menuiseries: 'anthracite', soubassement: 'pierre' };

for (const forme of ['l', 'u', 'cour', 'redans'] as const) {
  Deno.test(`BF-1 (${forme}) : forme à ailes AE0414 + brief riche validé dans l’Espace 3D → 1 bâtiment, ses ailes, habillage complet (clauses + loggias + détails)`, async () => {
    const d = await depotAE0414Reelle();
    eq((await executerOutilStudio('studio_preparer_3d', { forme }, env(d, `BF1-${forme}-P`)))?.status, 'ok');
    const garde = await executerOutilStudio('studio_lancer_rendu', { type: 'film' }, env(d, `BF1-${forme}-R1`));
    eq([garde?.status, garde?.data?.brief_requis], ['partial', true]);
    eq(garde!.data!.limites, { batiments: 1, balcons: true, ailes: true }, 'la carte sait que le bâtiment a des ailes');
    d.persister(garde);
    const carte = briefDuMessage(`Brief créatif validé pour le film (rendu) : Brique claire.\n\n\`\`\`${BRIEF_BLOC_LANGUE}\n${JSON.stringify({ v: 1, type: 'film', brief: { ...BRIEF_RICHE, a_toi_de_choisir: true } })}\n\`\`\``);
    ok(carte?.ok, JSON.stringify(carte));
    const r = await executerOutilStudio('studio_lancer_rendu', {}, env(d, `BF1-${forme}-R2`, { briefCarte: carte }));
    eq(r?.status, 'confirmation_requise', r?.message);
    eq((r!.data! as { limites?: unknown }).limites, { batiments: 1, balcons: true, ailes: true });
    d.persister(r);
    const l = await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env(d, `BF1-${forme}-R3`));
    eq(l?.status, 'ok', l?.message);
    const fiche = d.travaux[0].fiche as Record<string, unknown>;
    eq(fiche.habillage_batiments, {
      clauses: ['façade en brique claire', 'fenêtres verticales', 'avec attique', 'toiture végétalisée'],
      balcons: 'loggia',
      details: { gardeCorps: 'glass', menuiseries: 'av-aluminium-noir', soubassement: 'pierre-claire-contemp' },
    });
    const charge = fiche.charge as { batiments: Array<{ ailes: unknown[] }>; commandeArchitecture?: unknown };
    eq(charge.batiments.length, 1);
    eq(charge.batiments[0].ailes.length, { l: 2, u: 3, cour: 4, redans: 3 }[forme]);
    ok(batimentsAAiles(charge));
    const sortie = Deno.env.get('ECRIRE_FIXTURE_WORKER');
    if (sortie) await Deno.writeTextFile(`${sortie}/fiche-AE0414-forme-${forme}-brief-riche.json`, JSON.stringify(fiche, null, 2) + '\n');
  });
}

Deno.test('BF-2 : toit à deux pans sur un bâtiment à ailes — refusé (rien lancé) ; brief connu à deux pans → la carte se rouvre ; barres et plots : accepté', async () => {
  const d = await depotAE0414Reelle();
  eq((await executerOutilStudio('studio_preparer_3d', { forme: 'u' }, env(d, 'BF2-P')))?.status, 'ok');
  const r = await executerOutilStudio('studio_lancer_rendu', { type: 'film', brief: { facade: 'brique', toiture: 'deux_pans_tuiles' } }, env(d, 'BF2-R1'));
  eq(r?.status, 'error');
  ok(String(r?.message).startsWith(RAISON_PENTE_AILES) && /RIEN N’A ÉTÉ LANCÉ/.test(String(r?.message)), String(r?.message));
  eq(d.inserts, 0);
  // Plots (bâtiments rectangulaires) : le toit à deux pans reste proposé.
  const dp = await depotAE0414Reelle();
  eq((await executerOutilStudio('studio_preparer_3d', { forme: 'plots' }, env(dp, 'BF2-PP')))?.status, 'ok');
  const rp = await executerOutilStudio('studio_lancer_rendu', { type: 'film', brief: { facade: 'brique', toiture: 'deux_pans_tuiles' } }, env(dp, 'BF2-R2'));
  eq(rp?.status, 'confirmation_requise', rp?.message);
  eq((rp!.data! as { limites?: unknown }).limites, { batiments: 3, balcons: true, ailes: false });
  // Brief CONNU à deux pans (devis des plots), puis l'utilisateur passe en U : la carte se rouvre (aucun rendu promis).
  dp.persister(rp);
  eq((await executerOutilStudio('studio_preparer_3d', { forme: 'u' }, env(dp, 'BF2-PU')))?.status, 'ok');
  const ru = await executerOutilStudio('studio_lancer_rendu', { type: 'film' }, env(dp, 'BF2-R3'));
  eq([ru?.status, ru?.data?.brief_requis], ['partial', true], ru?.message);
  eq(ru!.data!.limites, { batiments: 1, balcons: true, ailes: true });
  eq(dp.inserts, 0);
  eq([batimentsAAiles(null), batimentsAAiles({ batiments: [{ ailes: [] }] }), batimentsAAiles({ batiments: [{ ailes: [1, 2] }] })], [false, false, true]);
});
