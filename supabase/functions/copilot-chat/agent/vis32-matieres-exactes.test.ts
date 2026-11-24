// deno test --no-lock --no-check -A supabase/functions/copilot-chat/agent/vis32-matieres-exactes.test.ts
// VIS-32 — la matière EXACTE du catalogue extérieur choisie à l'étape 4 atteint la fiche du rendu :
// brief `matieres` (liste blanche) → jeton de devis (forme « 3: », prix inchangé) → confirmation → fiche
// `habillage_batiments.details.matieres`. Une référence hors liste est ignorée et DITE, jamais un refus.
// Le dépôt en mémoire et la conception AE0414 sont repris de studio.test.ts (copie, même données).
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

// ═══ 2. Rendus : devis puis confirmation ═══════════════════════════════════════════════════════

async function preparer(d: DepotMemoire): Promise<string> {
  const r = await executerOutilStudio('studio_preparer_3d', {}, env(d));
  return String(r?.data?.preparation_id);
}

import { LISTE_BLANCHE_MATIERES, lireMatieresBrief } from '../../../../src/spaces/copilot/studio3d/matieresParPartie.ts';

Deno.test('VIS-32-1 : liste blanche — refs rendues (oui / réserve) de la bonne partie, sans qm- ; module importable par Deno', () => {
  eq(LISTE_BLANCHE_MATIERES.facade.get('av-pierre-de-taille')?.rendu, 'reserve');
  eq(LISTE_BLANCHE_MATIERES.facade.get('av-brique-rouge')?.rendu, 'oui');
  ok(!LISTE_BLANCHE_MATIERES.facade.has('qm-pierre-gres'), 'qm- (moteur de quartier) non transmissible');
  ok(!LISTE_BLANCHE_MATIERES.facade.has('av-ardoise'), 'une couverture n’est pas une façade');
  ok(LISTE_BLANCHE_MATIERES.toiture.has('pm-zinc') && LISTE_BLANCHE_MATIERES.garde_corps.has('rg-bois-balcon'));
  const n = Object.values(LISTE_BLANCHE_MATIERES).reduce((s, m) => s + m.size, 0);
  ok(n >= 80, `références par partie : ${n}`);
  const l = lireMatieresBrief({ facade: 'av-pierre-de-taille', toiture: 'av-brique-rouge', volets: 'x', menuiseries: 42 });
  eq(l.matieres, { facade: 'av-pierre-de-taille' });
  eq(l.ignorees.length, 3, l.ignorees.join(' | '));
  eq(lireMatieresBrief('nimporte').matieres, {});
});

Deno.test('VIS-32-2 : validerBrief — matières retenues, hors liste ou incohérentes ignorées ET dites ; jamais de refus', () => {
  const v = validerBrief({ facade: 'pierre', toiture: 'deux_pans_zinc', balcons: 'aucun', a_toi_de_choisir: true,
    matieres: { facade: 'av-pierre-de-taille', toiture: 'pm-zinc', garde_corps: 'av-acier', soubassement: 'xx-inconnue' } });
  ok(v.ok, !v.ok ? v.erreur : '');
  if (!v.ok) return;
  eq(v.valeur.matieres, { facade: 'av-pierre-de-taille', toiture: 'pm-zinc' });
  ok(v.valeur.matieresIgnorees!.some((x) => /soubassement : matière « xx-inconnue » hors du catalogue rendu/.test(x)), v.valeur.matieresIgnorees!.join(' | '));
  ok(v.valeur.matieresIgnorees!.some((x) => /garde-corps « Acier » ignorée \(sans balcon/.test(x)), v.valeur.matieresIgnorees!.join(' | '));
  ok(/matières du catalogue \(rendues telles quelles\) : façade « Pierre de taille » \(avec réserve\), toiture « Zinc à joint debout » \(avec réserve\)|matières du catalogue \(rendues telles quelles\) : façade « Pierre de taille » \(avec réserve\), toiture « [^»]+ » \(avec réserve\)/.test(libelleBrief(v.valeur)), libelleBrief(v.valeur));
  ok(/matières du catalogue ignorées/.test(libelleBrief(v.valeur)));
  const r = reservesBrief(v.valeur, 'preparation');
  ok(r.some((x) => /^Matières du catalogue avec réserve : façade « Pierre de taille »/.test(x)), r.join(' | '));
  ok(r.some((x) => /^Matières du catalogue non retenues/.test(x)));
  // Couverture incohérente avec le toit plat : ignorée, dite.
  const plat = validerBrief({ a_toi_de_choisir: true, matieres: { toiture: 'av-tuiles-terre-cuite' } });
  ok(plat.ok && !plat.valeur.matieres && /toit choisi plat/.test(plat.valeur.matieresIgnorees![0]!));
  // Brief SANS matières : strictement identique à avant VIS-32 (aucune clé ajoutée).
  const sans = validerBrief({ facade: 'brique', a_toi_de_choisir: true });
  ok(sans.ok && !('matieres' in sans.valeur) && !('matieresIgnorees' in sans.valeur));
  // Seulement des matières (sans autre choix) : accepté.
  ok(validerBrief({ matieres: { menuiseries: 'av-bois-peint-blanc' } }).ok);
});

Deno.test('VIS-32-3 : jeton — forme « 3: » aller-retour ; sans matière, forme « 2: » inchangée ; jeton forgé revalidé', () => {
  const v = validerBrief({ facade: 'pierre', toiture: 'deux_pans_zinc', a_toi_de_choisir: true, precisions: 'volets bleus. corniche',
    matieres: { facade: 'av-pierre-de-taille', toiture: 'pm-zinc', menuiseries: 'av-bois-peint-blanc' } });
  ok(v.ok);
  if (!v.ok) return;
  const j = encoderBrief(v.valeur);
  ok(j.startsWith('3:') && j.includes('.f=av-pierre-de-taille,m=av-bois-peint-blanc,t=pm-zinc.'), j);
  const relu = briefDuJeton(j)!;
  eq(relu.matieres, v.valeur.matieres);
  eq(relu.precisions, 'volets bleus. corniche');
  eq(relu.defauts, v.valeur.defauts);
  eq([relu.facade, relu.toiture], ['pierre', 'deux_pans_zinc']);
  const sans = validerBrief({ facade: 'brique', a_toi_de_choisir: true });
  ok(sans.ok && encoderBrief(sans.valeur).startsWith('2:'));
  // Jeton forgé avec une référence inconnue : relu sans elle (liste blanche à la relecture aussi).
  const forge = j.replace('f=av-pierre-de-taille', 'f=av-inventee');
  eq(briefDuJeton(forge)!.matieres, { menuiseries: 'av-bois-peint-blanc', toiture: 'pm-zinc' });
});

Deno.test('VIS-32-4 : bloc du message → devis (prix et jeton lisibles) → confirmation → fiche.habillage_batiments.details.matieres', async () => {
  const d = depotAvecConception();
  await preparer(d);
  const texte = 'Habillage choisi.\n\n```' + BRIEF_BLOC_LANGUE + '\n' + JSON.stringify({ v: 1, type: 'image', brief: {
    facade: 'pierre', menuiseries: 'blanc', a_toi_de_choisir: true,
    matieres: { facade: 'av-pierre-de-taille', menuiseries: 'av-bois-peint-blanc', toiture: 'qm-pierre-gres' } } }) + '\n```';
  const carte = briefDuMessage(texte);
  ok(carte?.ok, carte && !carte.ok ? carte.erreur : '');
  if (!carte?.ok) return;
  ok(/matières du catalogue ignorées : toiture : matière « qm-pierre-gres » hors du catalogue rendu/.test(consigneBriefCarte(carte)), consigneBriefCarte(carte));
  const avec = await executerOutilStudio('studio_lancer_rendu', { type: 'image', options: { vues: ['face'] } }, env(d, 'v32-a', { briefCarte: carte }));
  eq(avec?.status, 'confirmation_requise', avec?.message);
  const sansCarte = briefDuMessage(texte.replace(/,"matieres":\{[^}]*\}/, ''));
  ok(sansCarte?.ok);
  const sans = await executerOutilStudio('studio_lancer_rendu', { type: 'image', options: { vues: ['face'] } }, env(d, 'v32-b', { briefCarte: sansCarte! }));
  const devisA = avec!.data!.devis as Record<string, unknown>, devisB = sans!.data!.devis as Record<string, unknown>;
  eq([devisA.jetons, devisA.cout_jetons], [devisB.jetons, devisB.cout_jetons], 'les matières ne changent pas le prix');
  const sortie = JSON.stringify(avec);
  const jeton = String(avec!.data!.jeton_devis);
  ok(sortie.indexOf(jeton) + jeton.length < 900, `jeton à ${sortie.indexOf(jeton)} (+${jeton.length})`);
  ok((devisA.avertissements as string[] ?? []).concat(String(devisA.habillage ?? ''), JSON.stringify(devisA)).some((x) => /Pierre de taille/.test(x)), JSON.stringify(devisA).slice(0, 600));
  eq((avec!.data!.brief_actuel as Record<string, unknown>).matieres, { facade: 'av-pierre-de-taille', menuiseries: 'av-bois-peint-blanc' }, 'relu par la carte à la réouverture');
  d.persister(avec);
  const go = await executerOutilStudio('studio_lancer_rendu', { type: 'image', confirmer: true, jeton_devis: jeton }, env(d, 'v32-c'));
  eq(go?.status, 'ok', go?.message);
  const fiche = d.travaux.at(-1)!.fiche as Record<string, unknown>;
  const h = fiche.habillage_batiments as { details: Record<string, unknown> };
  eq(h.details.matieres, { facade: 'av-pierre-de-taille', menuiseries: 'av-bois-peint-blanc' });
  eq(h.details.matieresAvecReserve, ['facade']);
  eq(h.details.menuiseries, 'av-aluminium-blanc', 'la valeur fermée reste le repli');
});
