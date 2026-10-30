// deno test supabase/functions/agent-proactif-v1/logique.test.ts
import * as na from 'node:assert/strict';
const assert = (v: unknown, msg?: string) => na.ok(v, msg);
const assertEquals = (a: unknown, b: unknown) => na.deepStrictEqual(a, b);

import {
  alerteDansZone,
  budgetDisponible,
  construireElements,
  debutFenetre,
  devisVeille,
  executerProactif,
  localisationProjet,
  pireCasEtape,
  pireCasRapport,
  tierDepuisPlan,
  type DepotProactif,
  type EtatProactif,
  type NouveauBriefing,
  type NouvelleMission,
  type PrefsProactif,
  type SourcesBrutes,
  type WatchZone,
  type ZoneAlert,
} from './logique.ts';

const NOW = new Date('2026-10-31T03:23:00Z');
const H = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const UID = 'aaaaaaaa-0000-0000-0000-000000000001';

const vide = (): SourcesBrutes => ({ zones: [], alertes: [], matches: [], opportunites: [], appelsOffres: [], projets: [], permis: [] });

function ao(id: string, h: number, extra: Partial<SourcesBrutes['appelsOffres'][number]> = {}) {
  return { id, avis_id: 'A' + id, objet: `Travaux ${id}`, acheteur: 'Ville de Lyon', url: 'https://www.boamp.fr/avis/' + id,
    zone_incertaine: false, date_limite: '2026-11-20T12:00:00Z', is_read: false, created_at: H(h), ...extra };
}

function prefs(extra: Partial<PrefsProactif> = {}): PrefsProactif {
  return { user_id: UID, learning_enabled: true, proactif_actif: true, budget_proactif_mensuel: 1000,
    proactif_consomme_mois: 0, proactif_mois: '2026-10-01', ...extra };
}

class FauxDepot implements DepotProactif {
  missions: NouvelleMission[] = [];
  briefings: NouveauBriefing[] = [];
  appelsSources = 0;
  constructor(
    public s: SourcesBrutes,
    public etatV: EtatProactif = { actif: true, learning_enabled: true, budget_mensuel: 1000, consomme_mois: 0, restant: 1000 },
    public opts: { active?: boolean; solde?: number | null; engage?: number; refusMission?: boolean; tier?: 'haiku' | 'sonnet' | 'opus' } = {},
    public prefsV: PrefsProactif[] = [prefs()],
  ) {}
  utilisateursCandidats() { return Promise.resolve(this.prefsV); }
  etat() { return Promise.resolve(this.etatV); }
  engageNonRegle() { return Promise.resolve(this.opts.engage ?? 0); }
  curseur() {
    // Simule la base : curseur = dernier briefing créé par ce module ou dernière mission proactive.
    const c = [...this.briefings.map((b) => b.cree_le), ...this.missions.map((m) => String(m.criteres.curseur))].sort();
    return Promise.resolve(c.length ? c[c.length - 1] : null);
  }
  missionProactiveActive() { return Promise.resolve(this.opts.active ?? false); }
  sources() { this.appelsSources++; return Promise.resolve(this.s); }
  tier() { return Promise.resolve(this.opts.tier ?? 'sonnet'); }
  solde() { return Promise.resolve(this.opts.solde === undefined ? 5000 : this.opts.solde); }
  creerMission(m: NouvelleMission) {
    if (this.opts.refusMission) return Promise.resolve(null);
    this.missions.push(m); this.opts.active = true; return Promise.resolve('m-' + this.missions.length);
  }
  creerBriefing(b: NouveauBriefing) { this.briefings.push(b); return Promise.resolve('b-' + this.briefings.length); }
}

Deno.test('pire cas = formule du moteur (étape : 60k in, 4 096 out, 0 web ; rapport : 60k, 4 000)', () => {
  assertEquals([pireCasEtape('haiku'), pireCasEtape('sonnet'), pireCasEtape('opus')], [3, 7, 12]);
  assertEquals([pireCasRapport('haiku'), pireCasRapport('sonnet'), pireCasRapport('opus')], [3, 7, 12]);
  assertEquals(tierDepuisPlan('pro', 'active'), 'sonnet');
  assertEquals(tierDepuisPlan('pro', 'canceled'), 'haiku');
  assertEquals(tierDepuisPlan(null, null), 'haiku');
});

Deno.test('devis : plafonné au budget et à 10 étapes, émis/expire à +24 h ; null sous 3 étapes', () => {
  const d = devisVeille(1000, 'sonnet', 4, NOW)!;
  assertEquals([d.etapes_max, d.jetons_max, d.jetons_min], [10, 70, 28]);
  assertEquals(d.emis_le, NOW.toISOString());
  assertEquals(Date.parse(d.expire_le) - Date.parse(d.emis_le), 24 * 3600_000);
  const p = devisVeille(40, 'sonnet', 1, NOW)!;
  assertEquals([p.etapes_max, p.jetons_max], [5, 35]);
  assertEquals(devisVeille(20, 'sonnet', 1, NOW), null);
  assertEquals(devisVeille(21, 'sonnet', 1, NOW)!.etapes_max, 3);
  // Toujours de quoi payer une étape + le rapport final, jamais au-delà du budget.
  for (const t of ['haiku', 'sonnet', 'opus'] as const) {
    for (let b = 0; b < 300; b++) {
      const x = devisVeille(b, t, 1, NOW);
      if (x) assert(x.jetons_max <= b && x.jetons_max >= pireCasEtape(t) + pireCasRapport(t));
    }
  }
});

Deno.test('budget disponible = restant (base) − engagé non réglé, borné', () => {
  const e: EtatProactif = { actif: true, learning_enabled: true, budget_mensuel: 500, consomme_mois: 200, restant: 300 };
  assertEquals(budgetDisponible(e, 0), 300);
  assertEquals(budgetDisponible(e, 190), 110);
  assertEquals(budgetDisponible(e, 1000), 0);
  assertEquals(budgetDisponible({ ...e, restant: 99999 }, 0), 20000);
});

Deno.test('fenêtre : au plus 7 jours en arrière', () => {
  assertEquals(debutFenetre(null, NOW), new Date(NOW.getTime() - 7 * 86_400_000).toISOString());
  assertEquals(debutFenetre(H(5), NOW), H(5));
  assertEquals(debutFenetre(H(24 * 30), NOW), new Date(NOW.getTime() - 7 * 86_400_000).toISOString());
});

Deno.test('alertes de zone : IRIS strict, CP + commune, commune seule si zone entière', () => {
  const z = (x: Partial<WatchZone>): WatchZone => ({ id: 'z', label: 'Z', city: 'Saint-Étienne', postal_code: null, insee_code: null, iris_code: null, is_active: true, ...x });
  const a = (x: Partial<ZoneAlert>): ZoneAlert => ({ id: 'a', city: 'St Etienne', postal_code: null, iris_code: null, alert_type: 'hausse_prix', alert_score: 1, message: 'm', created_at: H(1), ...x });
  assert(alerteDansZone(a({}), z({})));
  assert(!alerteDansZone(a({}), z({ is_active: false })));
  assert(alerteDansZone(a({ iris_code: '1' }), z({ iris_code: '1' })));
  assert(!alerteDansZone(a({ iris_code: '2' }), z({ iris_code: '1' })));
  assert(alerteDansZone(a({ postal_code: '42000' }), z({ postal_code: '42000' })));
  assert(!alerteDansZone(a({ postal_code: '42000', city: 'Autre' }), z({ postal_code: '42000' })));
  assert(!alerteDansZone(a({}), z({ postal_code: '42000' }))); // zone précise, alerte imprécise → non
});

Deno.test('localisation projet : seulement si code INSEE explicite', () => {
  assertEquals(localisationProjet({ parcelle: { code_insee: '69123', lat: 45.76, lon: 4.83 } }), { insee: '69123', lat: 45.76, lon: 4.83 });
  assertEquals(localisationProjet({ commune: 'Lyon' }), null);
  assertEquals(localisationProjet({ insee: '2A004', lat: 'x' }), { insee: '2A004', lat: null, lon: null });
  assertEquals(localisationProjet(null), null);
});

Deno.test('éléments : filtres de précision et tri (AO puis permis puis opportunités puis marché)', () => {
  const s = vide();
  const depuis = H(48), jusqua = NOW.toISOString();
  s.appelsOffres = [
    ao('1', 2),
    ao('2', 2, { is_read: true }),
    ao('3', 2, { zone_incertaine: true }),
    ao('4', 2, { date_limite: H(1) }), // échéance passée
    ao('5', 100), // hors fenêtre
    ao('6', 2, { date_limite: '2026-11-05T12:00:00Z', url: 'javascript:x' }),
  ];
  s.projets = [{ id: 'p', name: 'Les Tilleuls', insee: '69123', lat: 45.76, lon: 4.83 }];
  const permis = (id: string, lat: number | null, lon: number | null, nb: number | null) => ({
    id, numero_permis: 'PC' + id, date_autorisation: '2026-10-01', commune_insee: '69123', commune: 'Lyon',
    nature_projet: 'Nouvelle construction', destination: 'Logement', nb_logements: nb, surface_plancher: 1200,
    latitude: lat, longitude: lon, created_at: H(3) });
  s.permis = [permis('a', 45.761, 4.831, 3), permis('b', 45.80, 4.90, 50), permis('c', null, null, 12), permis('d', null, null, 4)];
  s.opportunites = [
    { id: 'o1', event_type: 'price_drop', title: 'Immeuble de rapport', url: 'https://ex.fr/1', price: 900000, previous_price: 1000000, price_delta_pct: -10, score: 80, seen: false, created_at: H(1) },
    { id: 'o2', event_type: 'new', title: null, url: null, price: 1, previous_price: null, price_delta_pct: null, score: null, seen: false, created_at: H(1) },
    { id: 'o3', event_type: 'new', title: 'Déjà vue', url: null, price: 1, previous_price: null, price_delta_pct: null, score: null, seen: true, created_at: H(1) },
  ];
  s.zones = [{ id: 'z', label: 'Lyon 3e', city: 'Lyon', postal_code: '69003', insee_code: null, iris_code: null, is_active: true }];
  s.alertes = [
    { id: 'al1', city: 'Lyon', postal_code: '69003', iris_code: null, alert_type: 'hausse_prix', alert_score: 2, message: 'Prix en hausse de 4 %', created_at: H(5) },
    { id: 'al2', city: 'Lyon', postal_code: '69003', iris_code: null, alert_type: 'x', alert_score: 2, message: null, created_at: H(5) },
  ];
  const els = construireElements(s, depuis, jusqua, NOW);
  assertEquals(els.map((e) => e.source), [
    'ao_watch_events:6', 'ao_watch_events:1',
    'sitadel_permis:a', 'sitadel_permis:c',
    'opportunity_watch_events:o1',
    'zone_alerts:al1',
  ]);
  assertEquals(els[0].lien, undefined);
  assert(els[2].detail.includes('À environ'));
  assert(els[3].detail.includes('position exacte inconnue'));
  assert(els[4].detail.replace(/[\u202f\u00a0]/g, ' ').includes('900 000 €'));
});

Deno.test('rien de nouveau → ni mission ni briefing, 0 jeton', async () => {
  const d = new FauxDepot(vide());
  const [r] = await executerProactif(d, NOW);
  assertEquals(r.resultat, 'rien');
  assertEquals(d.missions.length + d.briefings.length, 0);
});

Deno.test('learning_enabled ou proactif désactivé → ignoré sans lire les veilles', async () => {
  const s = vide(); s.appelsOffres = [ao('1', 2)];
  const d1 = new FauxDepot(s, undefined, {}, [prefs({ learning_enabled: false })]);
  assertEquals((await executerProactif(d1, NOW))[0].resultat, 'ignore');
  assertEquals(d1.appelsSources, 0);
  const d2 = new FauxDepot(s, undefined, {}, [prefs({ proactif_actif: false })]);
  assertEquals((await executerProactif(d2, NOW))[0].resultat, 'ignore');
  // La base fait foi : désactivé entre-temps → ignoré, rien créé.
  const d3 = new FauxDepot(s, { actif: true, learning_enabled: false, budget_mensuel: 1000, consomme_mois: 0, restant: 1000 });
  assertEquals((await executerProactif(d3, NOW))[0].resultat, 'ignore');
  assertEquals(d3.missions.length + d3.briefings.length, 0);
});

Deno.test('éléments + budget + solde → mission en_attente plafonnée ; second passage idempotent', async () => {
  const s = vide(); s.appelsOffres = [ao('1', 2), ao('2', 3)];
  const d = new FauxDepot(s, { actif: true, learning_enabled: true, budget_mensuel: 50, consomme_mois: 0, restant: 50 });
  const [r] = await executerProactif(d, NOW);
  assertEquals(r.resultat, 'mission');
  const m = d.missions[0];
  assertEquals([m.origine, m.type, m.statut], ['proactif', 'veille', 'en_attente']);
  assert(m.devis.jetons_max <= 50);
  assertEquals(m.etapes_max, 7);
  assertEquals(m.devis.jetons_max, 49);
  assertEquals((m.criteres.evenements as unknown[]).length, 2);
  assertEquals(m.criteres.curseur, NOW.toISOString());
  // Même nuit, relancé : le curseur exclut les événements déjà confiés à la mission.
  const [r2] = await executerProactif(d, NOW);
  assertEquals(r2.resultat, 'rien');
  // Nouvel événement alors que la mission tourne encore : on attend, rien de créé.
  const plusTard = new Date(NOW.getTime() + 3600_000);
  s.appelsOffres.push({ ...ao('9', 0), created_at: new Date(NOW.getTime() + 1800_000).toISOString() });
  const [r3] = await executerProactif(d, plusTard);
  assertEquals(r3.resultat, 'mission_deja_active');
  // Mission close : le nouvel événement (et lui seul) part dans une nouvelle mission.
  d.opts.active = false;
  const [r4] = await executerProactif(d, plusTard);
  assertEquals(r4.resultat, 'mission');
  assertEquals((d.missions[1].criteres.evenements as { source: string }[]).map((e) => e.source), ['ao_watch_events:9']);
  // Rejoué : rien.
  d.opts.active = false;
  const [r5] = await executerProactif(d, plusTard);
  assertEquals(r5.resultat, 'rien');
  assertEquals(d.missions.length + d.briefings.length, 2);
});

Deno.test('budget insuffisant, engagé non réglé, solde insuffisant ou refus du plafond → briefing gratuit', async () => {
  const s = vide(); s.appelsOffres = [ao('1', 2)];
  const cas: [ConstructorParameters<typeof FauxDepot>[1], ConstructorParameters<typeof FauxDepot>[2], string][] = [
    [{ actif: true, learning_enabled: true, budget_mensuel: 0, consomme_mois: 0, restant: 0 }, {}, 'budget_insuffisant'],
    [undefined, { engage: 990 }, 'budget_insuffisant'],
    [undefined, { solde: 50 }, 'solde_insuffisant'],
    [undefined, { solde: null }, 'solde_inconnu'],
    [undefined, { refusMission: true }, 'creation_mission_refusee'],
  ];
  for (const [etat, opts, raison] of cas) {
    const d = new FauxDepot(s, etat, opts);
    const [r] = await executerProactif(d, NOW);
    assertEquals(r.resultat, 'briefing');
    assertEquals((r as { raison: string }).raison, raison);
    assertEquals(d.missions.length, 0);
    assertEquals(d.briefings[0].cree_le, NOW.toISOString());
    assertEquals(d.briefings[0].lu, false);
    // Idempotence : relancé juste après, le briefing ne se recrée pas.
    const [r2] = await executerProactif(d, new Date(NOW.getTime() + 1000));
    assertEquals(r2.resultat, 'rien');
    assertEquals(d.briefings.length, 1);
  }
});

Deno.test('une erreur sur un utilisateur ne bloque pas les autres', async () => {
  const s = vide(); s.appelsOffres = [ao('1', 2)];
  const d = new FauxDepot(s, undefined, {}, [prefs({ user_id: 'u1' }), prefs({ user_id: 'u2' })]);
  let n = 0;
  d.sources = () => (++n === 1 ? Promise.reject(new Error('panne')) : Promise.resolve(s));
  const r = await executerProactif(d, NOW);
  assertEquals(r.map((x) => x.resultat), ['erreur', 'mission']);
});
