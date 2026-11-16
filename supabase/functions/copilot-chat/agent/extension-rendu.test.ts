// supabase/functions/copilot-chat/agent/extension-rendu.test.ts
// LOT X4 site (14/11/2026) — rendu d'un projet d'EXTENSION ouvert dans le copilot :
//   · le projet d'extension (contrat X0) part avec TOUT rendu (image, film, visite) et la limite sur rue est recopiée dans
//     `charge.site.facadesVoie` pour tout rendu d'extension (le moteur d'extension de la machine de rendu la lit) ;
//   · le devis dit ce qui est dessiné (maison conservée, extension du moteur) et ce qui reste estimé ;
//   · le toit de la maison conservée doit être CONFIRMÉ dans le parcours (décision d'Albé), sinon rien n'est chiffré ;
//   · jamais depuis une version de conception (elle ne contient pas la maison conservée) : la 3D préparée est prise ;
//   · « démolir » après un projet d'extension annule ce projet pour les rendus.
// Données RÉELLES : parcours P0646 (fixture X3) ; 3D préparée et cadastre AS0249 (fixtures P2). Réseau simulé.
import * as na from 'node:assert/strict';
import { executerOutilStudio, type ConceptionLue, type DepotStudio, type EnvStudio, type PreparationLue, type StatsFile, type TravailLu } from './studio.ts';
import {
  avertissementsRenduExtension, MESSAGE_EXTENSION_VERSION, MESSAGE_TOIT_A_CONFIRMER, projetDesSorties, resultatParcours, RENDU_EXTENSION_OUVERT, toitConfirme,
  reglesDeLaConception,
} from './extension.ts';
import { facadesVoieDeLaParcelle } from './voisines-parcelle.ts';
import { lireProjetExtension, type ProjetExtension } from '../../_shared/extension/contrat.ts';
import { avancerParcours, ETAT_INITIAL, type ContexteParcours, type EtatParcours, type SortieParcours } from '../../_shared/extension/parcours.ts';
import { type BatimentBdTopo } from '../../_shared/extension/bdtopoParcelle.ts';
import { verifierCouverture } from '../../../../src/lib/studio/couverturePhotoRue.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const CONV = 'conv-extension-rendu';
const IDU = '93048000AS0249';
const CONCEPTION = '44444444-4444-4444-8444-444444444444';

const FX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/extension-x3-reel.json', import.meta.url)));
const CADASTRE = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/cadastre-93048000AS0249.json', import.meta.url)));
const PANORAMAX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/lib/studio/__fixtures__/panoramax-montreuil-AS0249.json', import.meta.url)));

// ── Parcours P0646 réel (même rejeu que extension-maison.test.ts) ──────────────────────────────────────────
type SiteFx = { idu: string; contourWgs84: [number, number][]; batiments: BatimentBdTopo[] };
function contexteP0646(): ContexteParcours {
  const s: SiteFx = FX.bdtopo.sites.find((x: SiteFx) => x.idu === '930470000P0646');
  const C = FX.conceptionP0646;
  const fac = facadesVoieDeLaParcelle(C.parcelle);
  return {
    idu: '930470000P0646', commune: 'Montfermeil', contourWgs84: s.contourWgs84, surfaceParcelleM2: C.parcelle.surface_m2 ?? null,
    batiments: s.batiments, raisonBdTopo: null, dateBdTopo: '2026-11-12', bdnb: null, noteBdnb: null,
    zoneU: { valeur: null, source: 'zonage non lu (test)' }, regles: reglesDeLaConception(C.regles_plu),
    facadesVoie: fac.facades.map((f) => ({ debut: f.debut, fin: f.fin })), raisonFacades: fac.raison,
  };
}
function jouer(messages: string[]): SortieParcours[] {
  const ctx = contexteP0646();
  const out: SortieParcours[] = [];
  let etat: EtatParcours = ETAT_INITIAL;
  let attendues: readonly string[] = [];
  for (const m of messages) { const s = avancerParcours(etat, m, attendues, ctx); out.push(s); etat = s.etat; attendues = s.attendues; }
  return out;
}
const PARCOURS = [
  'Je voudrais agrandir ma maison', 'Maison existante : Conserver la maison',
  'Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Arrière · Façade (vue de la rue) : À l’arrière',
  'Dimensions (largeur × profondeur) : 5 × 4 m · Hauteur de l’extension : Plain-pied', 'Surface de plancher existante : 118 m² · Demandeur : Particulier',
];
const FIN = jouer(PARCOURS)[4]!;
const sortieTerminee = (projet: ProjetExtension = FIN.projet!) => ({ etape: 'termine', etat: FIN.etat, projet_extension: projet, option_travail: FIN.optionTravail });
/** Même projet, mais toit resté à l'estimation (statut « SUPPOSÉE ») : jamais produit par le parcours, refusé au rendu. */
function projetToitSuppose(): ProjetExtension {
  const p = structuredClone(FIN.projet!) as unknown as { existants: { formeToit: { valeur: string; statut: string; source: string } }[] };
  p.existants[0]!.formeToit = { valeur: 'deux-pans', statut: 'supposee', source: 'règle R4 (test)' };
  const lu = lireProjetExtension(p);
  na.ok(lu.ok);
  return (lu as { projet: ProjetExtension }).projet;
}

// ── Dépôt en mémoire (même principe que photo-rue.test.ts), avec les sorties du parcours d'extension ─────────
class Depot implements DepotStudio {
  conceptions: Array<ConceptionLue & { user_id: string }> = [];
  preparations: Array<PreparationLue & { user_id: string }> = [];
  travaux: Array<TravailLu & { user_id: string; fiche: Record<string, unknown>; options: Record<string, unknown> }> = [];
  appels: Array<Record<string, unknown>> = [];
  sorties: Record<string, unknown>[] = [];
  version: { n: number; modele_ref: string } | null = null;
  stats: StatsFile | null = { attente: 0, plusAncienneAttente: null, enCours: 0, derniereActivite: null };
  async conception(u: string, q: { id?: string | null; idu?: string | null }) {
    return this.conceptions.filter((c) => c.user_id === u && (!q.id || c.id === q.id) && (!q.idu || c.idu === q.idu)).at(-1) ?? null;
  }
  async derniereVersion() { return this.version; }
  async enregistrerPreparation(u: string, l: Omit<PreparationLue, 'id' | 'cree_le'>) {
    const deja = this.preparations.find((p) => p.user_id === u && p.empreinte === l.empreinte);
    if (deja) return deja.id;
    const id = crypto.randomUUID();
    this.preparations.push({ ...structuredClone(l), id, user_id: u, cree_le: new Date().toISOString() });
    return id;
  }
  async preparation(u: string, q: { id?: string | null; conceptionId?: string | null; conversationId?: string | null }) {
    return this.preparations.filter((p) => p.user_id === u && (!q.id || p.id === q.id) && (!q.conceptionId || p.conception_id === q.conceptionId)).at(-1) ?? null;
  }
  async typeRenduAutorise() { return true; }
  async statsFile() { return this.stats; }
  async travauxActifs(u: string) { return this.travaux.filter((t) => t.user_id === u && ['en_attente', 'en_cours'].includes(t.statut)).length; }
  async travailParDevis(u: string, d: string) { return this.travaux.find((t) => t.user_id === u && t.fiche.devis_id === d) ?? null; }
  async questionBriefPosee() { return true; }
  async jetonsDevis() {
    return this.appels.slice().reverse().map((a) => (a.data as { jeton_devis?: unknown } | undefined)?.jeton_devis).filter((j): j is string => typeof j === 'string');
  }
  async insererTravail(u: string, l: { conversation_id: string; type: string; fiche: Record<string, unknown>; options: Record<string, unknown> }) {
    const t = { id: crypto.randomUUID(), user_id: u, conversation_id: l.conversation_id, type: l.type, statut: 'en_attente', progression: 0, etape: null,
      resultat: null, elements_omis: [], erreur: null, cree_le: new Date().toISOString(), demarre_le: null, termine_le: null, fiche: l.fiche, options: l.options };
    this.travaux.push(t);
    return t;
  }
  async travail(u: string, q: { id?: string | null }) { return this.travaux.filter((t) => t.user_id === u && (!q.id || t.id === q.id)).at(-1) ?? null; }
  async positionFile() { return 0; }
  async urlSigneeRendu(c: string) { return `https://exemple.supabase.co/storage/v1/object/sign/studio-rendus/${c}?token=t`; }
  async couverturePhotoRue(contour: [number, number][]) {
    return await verifierCouverture(contour, (async () => new Response(JSON.stringify(PANORAMAX), { status: 200 })) as typeof fetch, () => Date.parse('2026-11-11T12:00:00Z'));
  }
  /** Sorties `data` du parcours d'extension, la plus récente d'abord (comme copilot_tool_calls). */
  async sortiesExtension() { return [...this.sorties]; }
}

const env = (d: DepotStudio, requete: string): EnvStudio =>
  ({ userId: USER, depot: d, secret: 'secret-de-test', requete, conversationId: CONV, origine: 'https://mimmoza.vercel.app' });

async function depotPrepare(): Promise<Depot> {
  const d = new Depot();
  d.conceptions.push({
    id: CONCEPTION, idu: IDU, commune: 'Montreuil', user_id: USER, regles_plu: [], programme: { nb_logements: 6, gabarit: 'R+3' },
    parcelle: {
      idu: IDU, geometrie: CADASTRE.parcelle.geometry, surface_m2: null, source: 'cadastre (relevé réel)',
      voisines: { statut: 'disponibles', source: 'API Carto IGN', parcelles: CADASTRE.voisines.map((v: { geometry: unknown; properties?: { idu?: string } }) => ({ idu: v.properties?.idu ?? null, geometrie: v.geometry })) },
    },
  });
  const r = await executerOutilStudio('studio_preparer_3d', {}, env(d, 'P0'));
  na.equal(r?.status, 'ok', r?.message);
  return d;
}

const avert = (r: { data?: Record<string, unknown> } | null | undefined) => ((r?.data?.devis as { avertissements: string[] }).avertissements);
const site = (t: { fiche: Record<string, unknown> }) => (t.fiche.charge as { site: { facadesVoie?: unknown[] } }).site;

// ═══ Tests ══════════════════════════════════════════════════════════════════════════════════════════════

Deno.test('X4S-1 : rendu ouvert ; toit confirmé par le parcours ; devis et avertissements de l’extension', () => {
  na.equal(RENDU_EXTENSION_OUVERT, true);
  na.equal(FIN.etape, 'termine');
  na.equal(FIN.projet!.existants[0]!.formeToit!.statut, 'confirmee', 'le parcours ne se termine pas sans toit confirmé');
  na.equal(toitConfirme(FIN.projet!), true);
  na.equal(toitConfirme(projetToitSuppose()), false);
  const a = avertissementsRenduExtension(FIN.projet!, 'image');
  na.match(a[0]!, /maison existante est CONSERVÉE/);
  na.match(a[1]!, /forme du toit confirmée par vous ; pente du toit et orientation du faîtage ESTIMÉES/);
  na.match(a[2]!, /terrain supposé plat.*Aucun habillage de bâtiment neuf/);
  na.match(a[3]!, /« à valider »/);
  na.equal(avertissementsRenduExtension(FIN.projet!, 'film').length, 3, 'film : pas de phrase sur la photo');
});

Deno.test('X4S-2 : parcours — question explicite sur le toit, suggestion jamais présélectionnée ; jusqu’à la réponse, pas de synthèse', () => {
  const t = jouer(PARCOURS.slice(0, 2));
  na.match(t[1]!.texte, /\*\*Le toit de votre maison est-il bien à 2 pans \?\*\* C’est une estimation \(SUPPOSÉE\)/);
  na.match(t[1]!.blocChoix!, /"id":"x3_toit","libelle":"Toit de la maison","options":\["2 pans","4 pans","Toit plat","Monopente"\]/);
  // Réponse sans le toit : la question revient, le parcours n'avance pas jusqu'à la synthèse.
  const sans = jouer([...PARCOURS.slice(0, 2), 'Niveaux de la maison : R+1 · Type d’extension : Arrière · Façade (vue de la rue) : À l’arrière',
    'Dimensions (largeur × profondeur) : 5 × 4 m · Hauteur de l’extension : Plain-pied', 'Surface de plancher existante : 118 m² · Demandeur : Particulier']);
  na.ok(sans.every((s) => s.etape !== 'termine' && s.projet === null));
  na.match(sans.at(-1)!.blocChoix!, /"id":"x3_toit"/);
  // Toit corrigé (4 pans) : confirmé, estimation d'origine citée dans la source.
  const corrige = jouer([PARCOURS[0]!, PARCOURS[1]!, PARCOURS[2]!.replace('2 pans', '4 pans'), PARCOURS[3]!, PARCOURS[4]!])[4]!;
  na.deepEqual([corrige.projet!.existants[0]!.formeToit!.valeur, corrige.projet!.existants[0]!.formeToit!.statut], ['quatre-pans', 'confirmee']);
  na.match(corrige.projet!.existants[0]!.formeToit!.source, /estimation proposée : 2 pans/);
});

Deno.test('X4S-3 : message au modèle en fin de parcours — rendu proposable si le moteur place l’extension, jamais s’il la refuse', () => {
  na.match(resultatParcours(FIN).message!, /Tu peux proposer, en une phrase, un rendu de l’extension/);
  const refus = jouer([PARCOURS[0]!, PARCOURS[1]!, 'Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Latérale · Façade (vue de la rue) : À droite',
    'Dimensions (largeur × profondeur) : 6 × 4 m · Hauteur de l’extension : Plain-pied', PARCOURS[4]!])[4]!;
  na.equal(refus.resultatMoteur!.ok, false);
  na.match(resultatParcours(refus).message!, /ne propose pas de rendu/);
  na.doesNotMatch(resultatParcours(refus).message!, /Tu peux proposer/);
});

Deno.test('X4S-4 : FILM d’une extension — devis depuis la 3D préparée, puis fiche avec projet_extension ET facadesVoie, sans option existant', async () => {
  const d = await depotPrepare();
  d.sorties = [sortieTerminee()];
  const r1 = await executerOutilStudio('studio_lancer_rendu', { type: 'film', brief: { a_toi_de_choisir: true } }, env(d, 'R1'));
  na.equal(r1?.status, 'confirmation_requise', r1?.message);
  na.ok(avert(r1).some((a) => /maison existante est CONSERVÉE/.test(a)));
  na.match(String((r1!.data!.devis as { source: string }).source), /3D préparée par Mimmo/);
  na.equal('habillage' in (r1!.data!.devis as Record<string, unknown>), false, 'pas d’habillage de bâtiment neuf pour une extension');
  na.ok(!avert(r1).some((a) => /bâtiments : chacun est reconstruit|volume préparé/.test(a)), 'pas d’avertissement du volume neuf');
  d.appels.push(structuredClone(r1!) as unknown as Record<string, unknown>);
  const r2 = await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env(d, 'R2'));
  na.equal(r2?.status, 'ok', r2?.message);
  const t = d.travaux.at(-1)!;
  na.equal(t.type, 'film');
  na.deepEqual(t.fiche.projet_extension, FIN.projet, 'projet transmis tel quel (contrat X0)');
  na.ok(lireProjetExtension(t.fiche.projet_extension).ok);
  na.equal((site(t).facadesVoie ?? []).length, 2, 'limite sur rue recopiée pour un film d’extension');
  na.equal('existant' in t.options, false, 'l’option existant reste réservée à l’image');
});

Deno.test('X4S-5 : IMAGE d’une extension — option existant: conserver, projet et façades ; devis d’image antérieur au projet refusé', async () => {
  const d = await depotPrepare();
  // Devis d'image établi AVANT le projet d'extension : sans `existant`.
  const avant = await executerOutilStudio('studio_lancer_rendu', { type: 'image', brief: { a_toi_de_choisir: true } }, env(d, 'R0'));
  na.equal(avant?.status, 'confirmation_requise', avant?.message);
  na.equal('existant' in (avant!.data!.options as Record<string, unknown>), false);
  d.appels.push(structuredClone(avant!) as unknown as Record<string, unknown>);
  d.sorties = [sortieTerminee()];
  const vieux = await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env(d, 'R1'));
  na.equal(vieux?.status, 'error');
  na.match(vieux!.message!, /enregistré après ce devis.*RIEN N’A ÉTÉ LANCÉ/);
  na.equal(d.travaux.length, 0);
  // Nouveau devis : il porte l'extension.
  const r1 = await executerOutilStudio('studio_lancer_rendu', { type: 'image', brief: { a_toi_de_choisir: true } }, env(d, 'R2'));
  na.equal(r1?.status, 'confirmation_requise', r1?.message);
  na.equal((r1!.data!.options as Record<string, unknown>).existant, 'conserver');
  na.ok(avert(r1).some((a) => /« à valider »/.test(a)));
  d.appels.push(structuredClone(r1!) as unknown as Record<string, unknown>);
  const r2 = await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env(d, 'R3'));
  na.equal(r2?.status, 'ok', r2?.message);
  const t = d.travaux.at(-1)!;
  na.equal(t.options.existant, 'conserver');
  na.deepEqual(t.fiche.projet_extension, FIN.projet);
  na.equal((site(t).facadesVoie ?? []).length, 2);
});

Deno.test('X4S-6 : toit NON confirmé → rien n’est chiffré ni lancé (devis et confirmation)', async () => {
  const d = await depotPrepare();
  d.sorties = [sortieTerminee(projetToitSuppose())];
  const r = await executerOutilStudio('studio_lancer_rendu', { type: 'image', brief: { a_toi_de_choisir: true } }, env(d, 'R1'));
  na.equal(r?.status, 'partial');
  na.equal(r!.message, MESSAGE_TOIT_A_CONFIRMER);
  // Devis établi avec le toit confirmé, puis projet remplacé par un projet au toit supposé : la confirmation refuse aussi.
  d.sorties = [sortieTerminee()];
  const r1 = await executerOutilStudio('studio_lancer_rendu', { type: 'film', brief: { a_toi_de_choisir: true } }, env(d, 'R2'));
  na.equal(r1?.status, 'confirmation_requise', r1?.message);
  d.appels.push(structuredClone(r1!) as unknown as Record<string, unknown>);
  d.sorties = [sortieTerminee(projetToitSuppose())];
  const r2 = await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env(d, 'R3'));
  na.equal(r2?.status, 'partial');
  na.equal(r2!.message, MESSAGE_TOIT_A_CONFIRMER);
  na.equal(d.travaux.length, 0);
});

Deno.test('X4S-7 : version de conception — la 3D préparée est prise d’office ; version demandée ou devis d’une version → refus', async () => {
  const d = await depotPrepare();
  d.version = { n: 3, modele_ref: 'modele-3' };
  // Sans extension : la version est prise (comportement d'origine), et son devis est présenté.
  const v = await executerOutilStudio('studio_lancer_rendu', { type: 'film', brief: { a_toi_de_choisir: true } }, env(d, 'R1'));
  na.equal(v?.status, 'confirmation_requise', v?.message);
  na.match(String((v!.data!.devis as { source: string }).source), /version 3/);
  d.appels.push(structuredClone(v!) as unknown as Record<string, unknown>);
  // Le projet d'extension arrive : le devis de la version ne se lance pas.
  d.sorties = [sortieTerminee()];
  const c = await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env(d, 'R2'));
  na.equal(c?.status, 'partial');
  na.equal(c!.message, MESSAGE_EXTENSION_VERSION);
  na.equal(d.travaux.length, 0);
  // Avec l'extension : source automatique → 3D préparée ; source « version » demandée → refus.
  const p = await executerOutilStudio('studio_lancer_rendu', { type: 'film', brief: { a_toi_de_choisir: true } }, env(d, 'R3'));
  na.equal(p?.status, 'confirmation_requise', p?.message);
  na.match(String((p!.data!.devis as { source: string }).source), /3D préparée par Mimmo/);
  const q = await executerOutilStudio('studio_lancer_rendu', { type: 'film', source: 'version', brief: { a_toi_de_choisir: true } }, env(d, 'R4'));
  na.equal(q?.status, 'partial');
  na.equal(q!.message, MESSAGE_EXTENSION_VERSION);
});

Deno.test('X4S-8 : projet de la conversation — « démolir » après coup l’annule ; une panne de source ne l’efface pas', () => {
  const termine = sortieTerminee();
  na.ok(projetDesSorties([termine]));
  const demolir = { etape: 'neuf', etat: { ...FIN.etat, conserver: false } };
  na.equal(projetDesSorties([demolir, termine]), null, 'le plus récent d’abord : démolition après le projet');
  na.ok(projetDesSorties([termine, demolir]), 'projet repris après une démolition plus ancienne');
  const panne = { etape: 'sans_bdtopo', etat: FIN.etat };
  na.deepEqual(projetDesSorties([panne, termine])?.projet, FIN.projet);
});

Deno.test('X4S-9 : aucun nom d’outil interne dans les textes montrés', () => {
  const OUTILS = /\b(?:get_[a-z_]+|extension_maison|studio_[a-z_]+|lire_regles_plu_importees)\b/;
  for (const t of [MESSAGE_TOIT_A_CONFIRMER, MESSAGE_EXTENSION_VERSION, ...avertissementsRenduExtension(FIN.projet!, 'image'), jouer(PARCOURS.slice(0, 2))[1]!.texte]) na.doesNotMatch(t, OUTILS);
});

Deno.test('X4S-10 : extension — aucune question d’habillage (carte du brief) ; l’ambiance d’un brief fourni reste dans les options', async () => {
  const d = await depotPrepare();
  d.questionBriefPosee = async () => false;
  // Sans extension, la question groupée d'habillage serait posée (comportement d'origine).
  const neuf = await executerOutilStudio('studio_lancer_rendu', { type: 'film' }, env(d, 'R0'));
  na.notEqual(neuf?.status, 'confirmation_requise');
  d.sorties = [sortieTerminee()];
  const r = await executerOutilStudio('studio_lancer_rendu', { type: 'film' }, env(d, 'R1'));
  na.equal(r?.status, 'confirmation_requise', r?.message);
  const f = await executerOutilStudio('studio_lancer_rendu', { type: 'image', brief: { ambiance: 'fin_de_journee', a_toi_de_choisir: true } }, env(d, 'R2'));
  na.equal(f?.status, 'confirmation_requise', f?.message);
  na.equal((f!.data!.options as Record<string, unknown>).ambiance, 'fin_de_journee');
  na.equal('habillage' in (f!.data!.devis as Record<string, unknown>), false);
});
