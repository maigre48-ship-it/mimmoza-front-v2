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
  controlerVolume, depotStudioSupabase, dureeAnnoncee, etatMachine, executerOutilStudio, ficheDepuisPreparation, formuleRecul,
  idRequete, jsonCanonique, lireJeton, lireRegles, niveauxDuGabarit, preparerVolume, programmeVolume, reglesVolume, signerJeton,
  studioPertinent, validerOptionsRendu,
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
  const r = await executerOutilStudio('studio_lancer_rendu', { type: 'image', options: { vues: ['face', 'trois_quarts_gauche'] } }, env(d));
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
  const devis = await executerOutilStudio('studio_lancer_rendu', { type: 'film', options: { duree_s: 30 } }, env(d, 'rq-A'));
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

Deno.test('E1-8 : jeton falsifié, d’un autre utilisateur ou expiré → refus, rien de lancé', async () => {
  const d = depotAvecConception();
  await preparer(d);
  const devis = await executerOutilStudio('studio_lancer_rendu', { type: 'visite360' }, env(d, 'rq-1'));
  const jeton = String(devis!.data!.jeton_devis);
  const [corps, sig] = jeton.split('.');
  const falsifie = `${corps.slice(0, -2)}AA.${sig}`;
  eq((await executerOutilStudio('studio_lancer_rendu', { confirmer: true, jeton_devis: falsifie }, env(d, 'rq-2')))?.status, 'error');
  eq((await executerOutilStudio('studio_lancer_rendu', { confirmer: true, jeton_devis: jeton }, { ...env(d, 'rq-2'), userId: AUTRE }))?.status, 'error');
  const tard = await executerOutilStudio('studio_lancer_rendu', { confirmer: true, jeton_devis: jeton }, { ...env(d, 'rq-2'), maintenant: () => Date.now() + 31 * 60_000 });
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
  const r = await executerOutilStudio('studio_lancer_rendu', { type: 'image' }, env(d));
  eq(r?.status, 'not_configured'); ok(/lot E0/.test(r!.message!));
  eq((await executerOutilStudio('studio_lancer_rendu', { type: 'film' }, env(d)))?.status, 'confirmation_requise');
  // Base muette (sonde impossible) : le devis est établi ; le refus de la base à l'insertion est traduit.
  d.imageAutorisee = null;
  const devis = await executerOutilStudio('studio_lancer_rendu', { type: 'image' }, env(d, 'rq-1'));
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
  const devis = await executerOutilStudio('studio_lancer_rendu', { type: 'film' }, env(d, 'rq-1'));
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
  const devis = await executerOutilStudio('studio_lancer_rendu', { type: 'film' }, env(d));
  ok(((devis!.data!.devis as Record<string, unknown>).avertissements as string[]).some((a) => /disposition peut différer/.test(a)));
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
  ok(appels.some((a) => a.startsWith('jwt:agent_conceptions.eq(user_id,' + USER)));
  ok(appels.some((a) => a.startsWith('jwt:studio_preparations.upsert(') && a.includes('user_id,empreinte')), appels.join('\n'));
  ok(appels.some((a) => a.startsWith('jwt:studio_jobs.insert(')), 'insertion avec le client utilisateur');
  ok(appels.some((a) => a === 'jwt:studio_jobs.eq(fiche->>devis_id,d)'));
  ok(!appels.some((a) => a.startsWith('admin:studio_jobs.insert')), 'jamais d’insertion en service_role');
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
