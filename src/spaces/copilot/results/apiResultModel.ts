import type { ActiveToolCall } from '../types/copilot.types';

type RecordData = Record<string, unknown>;
export type ApiFamily = 'parcel' | 'urbanism' | 'market' | 'risk' | 'energy' | 'building' | 'cost' | 'context' | 'business' | 'finance';
export type ApiMetric = { label: string; value: string; numericValue?: number; unit?: string; note?: string };
export type ApiBars = { title: string; unit: string; max?: number; items: { label: string; value: number; tone?: string }[] };
export type ApiTable = { title: string; columns: string[]; rows: string[][]; values?: (string | number | boolean | null)[][]; units?: string[]; total?: number; links?: (string | null)[] };
export type ApiResultModel = {
  family: ApiFamily; title: string; state: 'running' | 'ready' | 'partial' | 'empty' | 'error';
  summary: string | null; source: string | null; scope: string | null; date: string | null; dateLabel: string; url: string | null;
  metrics: ApiMetric[]; charts: ApiBars[]; tables: ApiTable[]; notes: string[];
  range?: { title: string; low: number; mid: number; high: number; unit: string };
};
const PROFILES: Record<string, [ApiFamily, string]> = {
  get_parcel_summary: ['parcel', 'Parcelle cadastrale'], get_parcelle_depuis_adresse: ['parcel', 'Adresse et parcelle détectée'], get_etude_parcelle: ['parcel', 'Étude de parcelle'],
  get_parcel_plu: ['urbanism', 'Règles du PLU'], get_zonage_plu: ['urbanism', 'Zonage d’urbanisme'], get_prescriptions_urbanisme: ['urbanism', 'Prescriptions d’urbanisme'], get_servitudes: ['urbanism', 'Servitudes d’utilité publique'], get_monuments_historiques: ['urbanism', 'Patrimoine et monuments'], get_zonage_abc: ['urbanism', 'Zonage ABC'],
  get_dvf_comparables: ['market', 'Ventes comparables · DVF'], get_etude_marche: ['market', 'Étude de marché'], get_quick_market_insight: ['market', 'Position du bien sur le marché'], compute_smartscore: ['market', 'SmartScore de l’emplacement'], get_loyers_reference: ['market', 'Loyers de référence'], get_analyse_predictive: ['market', 'Projection de valeur'], get_veille_marche: ['market', 'Veille du marché'], recherche_biens: ['market', 'Biens repérés'],
  get_risks_georisques: ['risk', 'Étude des risques'], get_ppr_detail: ['risk', 'Plans de prévention des risques'], get_classement_sonore: ['risk', 'Classement sonore des voies'], get_altimetrie: ['risk', 'Altitude et pente'],
  get_dpe_ademe: ['energy', 'Diagnostics énergétiques · ADEME'], get_potentiel_solaire: ['energy', 'Potentiel solaire · PVGIS'],
  get_batiment_bdnb: ['building', 'Caractéristiques du bâtiment'], get_assainissement: ['building', 'Assainissement communal'],
  get_couts_construction: ['cost', 'Budget de construction'], get_couts_renovation: ['cost', 'Budget de rénovation'],
  get_contexte_commune: ['context', 'Contexte de la commune'], get_equipements_proches: ['context', 'Équipements à proximité'], get_sitadel: ['context', 'Permis de construire · Sitadel'], get_logement_social: ['context', 'Logement social'],
  get_etablissements_proches: ['business', 'Établissements à proximité'], get_operateurs_candidats: ['business', 'Exploitants à qualifier'], get_proprietaire_parcelle: ['business', 'Propriétaires personnes morales'], get_contacts_mairies: ['business', 'Contacts des mairies'], get_appels_offres: ['business', 'Appels d’offres publics'], lister_nouveautes_appels_offres: ['business', 'Nouveaux appels d’offres'], lister_watchlists: ['business', 'Recherches enregistrées'], lister_zones_veille: ['business', 'Zones surveillées'], lister_veilles_appels_offres: ['business', 'Veilles appels d’offres'],
  get_taxes_locales: ['finance', 'Fiscalité locale'], get_dispositif_fiscal: ['finance', 'Dispositif fiscal'], get_bilan_promoteur: ['finance', 'Bilan enregistré'],
};
export const record = (v: unknown): RecordData => v && typeof v === 'object' && !Array.isArray(v) ? v as RecordData : {};
export const number = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
const text = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.trim() : null;
const at = (root: unknown, path: string): unknown => path.split('.').reduce<unknown>((v, key) => record(v)[key], root);
const first = (root: unknown, ...paths: string[]) => paths.map((path) => at(root, path)).find((v) => v !== null && v !== undefined);
export function safeSourceUrl(value: unknown): string | null {
  try { const u = new URL(String(value)); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; }
}
export function formatApiValue(value: unknown, unit = ''): string {
  if (value === null || value === undefined) return 'Non renseigné';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string').join(' · ') || 'Non renseigné';
  if (number(value) !== null) return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value as number)}${unit ? ` ${unit}` : ''}`;
  return text(value) ?? 'Non renseigné';
}
const LABELS: Record<string, string> = {
  market: 'Marché', price_opportunity: 'Position prix', services: 'Services', transport: 'Transports', ecoles: 'Écoles', sante: 'Santé', environment: 'Environnement', demographie: 'Démographie', competition: 'Concurrence', rural_accessibility: 'Accessibilité',
  PC: 'Permis de construire', PA: 'Permis d’aménager', PD: 'Permis de démolir', DP: 'Déclarations préalables',
  demande: 'Contexte de demande', offre: 'Marché / liquidité', environnement: 'Équipements / services', accessibilite: 'Desserte en transports', global: 'Synthèse du modèle',
  commune: 'Commune', code_insee: 'Code INSEE', zone: 'Zone', annee: 'Année', millesime: 'Millésime', type: 'Type', usage: 'Usage', statut: 'Statut', total: 'Total', analyses: 'Éléments analysés', actif: 'Actif', actives: 'Actives', inactives: 'Inactives',
};
const labelOf = (key: string) => LABELS[key] ?? key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const sourceName = (v: unknown) => {
  const raw = text(v);
  return raw?.replace(/dvf-comparables-v1/g, 'DVF · DGFiP').replace(/risk-study-v\d+/g, 'Étude des risques · Mimmoza').replace(/market-study/g, 'Étude de marché · Mimmoza').replace(/gpu-parcelle-v1/g, 'Géoportail de l’urbanisme').replace(/dpe-ademe-v1/g, 'DPE · ADEME').replace(/couts-construction-v1/g, 'Barème construction · Mimmoza').replace(/couts-renovation-v1/g, 'Barème rénovation · Mimmoza') ?? null;
};

/** Adaptateurs de lecture : jamais de nouvelle requête, de valeur IA ou de défaut à zéro. */
export function buildApiResult(call: ActiveToolCall, options: { tableLimit?: number } = {}): ApiResultModel | null {
  const profile = PROFILES[call.name];
  if (!profile) return null;
  const out = record(call.output), d = record(out.data), s = record(d.stats);
  const status = text(out.status) ?? (out.ok === true ? 'ok' : call.status);
  const failed = ['error', 'not_configured'].includes(status) || (call.status === 'error' && out.ok !== true && !['not_found', 'empty', 'partial'].includes(status));
  const empty = d.empty === true || ['not_found', 'empty', 'no_data'].includes(status);
  const resultDate = first(d, 'stats.millesime', 'stats.annee', 'millesime', 'millesime_baremes', 'resultat.millesimeBaremes', 'commune.generated_at', 'enregistre_le', 'consulté_le', 'projection.generatedAt');
  const model: ApiResultModel = {
    family: profile[0], title: profile[1], state: call.status === 'running' ? 'running' : failed ? 'error' : status === 'partial' || d.donnee_partielle === true ? 'partial' : empty ? 'empty' : 'ready',
    summary: text(d.summary) ?? text(d.description) ?? text(d.message) ?? text(out.message), source: sourceName(d.source ?? s.source ?? out.source),
    scope: text(first(d, 'marche_dvf.perimetre_label', 'perimetre_label', 'precision', 'stats.precision', 'perimetre')),
    date: typeof resultDate === 'number' && Number.isFinite(resultDate) ? String(resultDate) : text(resultDate),
    dateLabel: first(d, 'stats.millesime', 'stats.annee', 'millesime', 'millesime_baremes', 'resultat.millesimeBaremes') != null ? 'Millésime' : 'Date du résultat',
    url: safeSourceUrl(d.url ?? d.sourceUrl ?? d.source ?? s.source ?? out.source), metrics: [], charts: [], tables: [], notes: [],
  };
  if (model.date === 'Non renseigné') model.date = null;
  const note = (value: unknown) => { const t = text(value); if (t && !model.notes.includes(t)) model.notes.push(t); };
  const metric = (label: string, value: unknown, unit = '', hint?: string) => model.metrics.push({ label, value: formatApiValue(value, unit), ...(number(value) !== null ? { numericValue: value as number, ...(unit ? { unit } : {}) } : {}), ...(hint ? { note: hint } : {}) });
  const bars = (title: string, values: unknown, unit = '', max?: number) => {
    const items = Object.entries(record(values)).flatMap(([key, raw]) => { const value = number(raw); return value !== null && value >= 0 && (max === undefined || value <= max) ? [{ label: labelOf(key), value }] : []; });
    if (items.length) model.charts.push({ title, unit, max, items });
  };
  const table = (title: string, items: unknown, columns: [string, string[], string?][], linkPaths?: string[]) => {
    if (!Array.isArray(items) || !items.length) return;
    const selected = items.slice(0, Math.max(1, options.tableLimit ?? 8));
    const rows = selected.map((item) => columns.map(([, paths, unit]) => formatApiValue(first(item, ...paths), unit)));
    const values = selected.map((item) => columns.map(([, paths]) => {
      const raw = first(item, ...paths);
      return number(raw) !== null || typeof raw === 'boolean' ? raw as number | boolean : raw == null ? null : formatApiValue(raw);
    }));
    model.tables.push({ title, columns: columns.map(([label]) => label), rows, values, units: columns.map(([, , unit]) => unit ?? ''), total: items.length,
      ...(linkPaths ? { links: selected.map((item) => safeSourceUrl(first(item, ...linkPaths))) } : {}) });
  };
  [d.avertissement, s.avertissement, s.note, d.note, d.note_regles, d.note_repli, d.adequation_programme && record(d.adequation_programme).avertissement].forEach(note);
  for (const item of Array.isArray(d.avertissements) ? d.avertissements : []) note(item);
  if (model.scope === 'centre_commune') { model.scope = 'Centre de commune'; note('Recherche centrée sur la commune, pas sur une parcelle précisément localisée.'); }
  if (model.scope === 'parcelle') model.scope = 'Parcelle localisée';
  const location = text(first(d, 'adresse.libelle', 'commune.commune_nom', 'commune_terrain', 'commune_centre', 'commune_nom', 'nom_commune', 'stats.commune_nom', 'batiment_principal.adresse', 'zone.commune', 'criteres.ville')) ?? text(d.commune);
  if (location) model.scope = [location, model.scope].filter(Boolean).join(' · ');
  if (number(d.rayon_km) !== null) model.scope = [model.scope, `Rayon de recherche ${formatApiValue(d.rayon_km, 'km')}`].filter(Boolean).join(' · ');
  if (number(d.rayon_m) !== null) model.scope = [model.scope, `Rayon de recherche ${formatApiValue(d.rayon_m, 'm')}`].filter(Boolean).join(' · ');
  if (model.state === 'running' || failed) {
    model.summary = failed ? 'Cette source n’a pas fourni de résultat exploitable. Les autres cartes restent consultables.' : null;
    return model;
  }

  switch (call.name) {
    case 'get_dvf_comparables': {
      metric('Prix médian', s.price_median_eur_m2, '€/m²'); metric('Transactions', s.transactions_count); metric('Prix moyen', s.price_mean_eur_m2, '€/m²');
      const low = number(s.price_q1_eur_m2), mid = number(s.price_median_eur_m2), high = number(s.price_q3_eur_m2);
      if (low !== null && mid !== null && high !== null && low <= mid && mid <= high && high > low) model.range = { title: 'Moitié centrale des prix · Q1 à Q3', low, mid, high, unit: '€/m²' };
      table('Ventes comparables', d.comparables, [['Date', ['date']], ['Bien', ['adresse', 'commune', 'type_local']], ['Surface', ['surface_m2'], 'm²'], ['Prix', ['price_m2'], '€/m²']]);
      note('Prix de ventes observées, pas un coût de construction ni une estimation automatique du projet.'); break;
    }
    case 'get_etude_marche': {
      const dvf = record(d.marche_dvf), demo = record(d.demographie_insee);
      const programme = text(at(d, 'commune.project_type_label'));
      if (programme) model.title = `Étude de marché · ${programme}`;
      metric('Prix médian DVF', dvf.prix_m2_median, '€/m²', text(dvf.perimetre_label) ?? 'Périmètre à vérifier');
      metric(dvf.nb_transactions_plafonne === true ? 'Transactions · au moins' : 'Transactions DVF', dvf.nb_transactions);
      metric('Population', demo.population, 'habitants'); metric('Équipements recensés', at(d, 'equipements_bpe.total_equipements'));
      const scores = record(d.scores);
      const indices = Object.fromEntries(['demande', 'offre', 'environnement', 'accessibilite', 'global'].filter(k => number(scores[k]) !== null).map(k => [k, scores[k]]));
      bars('Indices de contexte · ne classent pas les programmes', indices, '/100', 100);
      if (number(scores.demande_champs_mesures) !== null || number(scores.demande_champs_attendus) !== null) {
        metric('Champs de demande mesurés', scores.demande_champs_mesures);
        metric('Champs de demande attendus', scores.demande_champs_attendus);
      }
      if (scores.demande_champs_mesures === 0) note('Aucun champ de demande mesuré : cet indice ne constitue pas une mesure de la demande locale.');
      note('DVF tous biens et loyers résidentiels ne prouvent pas un prix ni un loyer tertiaire.');
      note('Les indices décrivent le contexte mesuré. Ils ne prouvent ni la demande propre au programme ni son chiffre d’affaires.');
      if (dvf.perimetre === 'departement') note('DVF à l’échelle du département : aucune médiane communale calculable.');
      if (demo.coverage === 'none' || demo.coverage === 'unavailable') note('Données démographiques non mesurées.');
      table('Constats de l’étude', d.constats, [['Thème', ['categorie']], ['Constat', ['message']]]); break;
    }
    case 'compute_smartscore':
      metric('Score de l’emplacement', d.score, '/100'); metric('Piliers mesurés', at(d, 'confiance.piliers_mesures')); metric('Piliers attendus', at(d, 'confiance.piliers_total'));
      bars('Piliers mesurés', d.piliers, '/100', 100); note('Un pilier absent n’est pas évalué : aucune valeur moyenne n’est ajoutée.'); break;
    case 'get_quick_market_insight':
      metric('Prix du bien', first(d, 'prix_m2_bien', 'computed_price_m2'), '€/m²'); metric('Référence de marché', first(d, 'prix_m2_marche', 'median_price_m2'), '€/m²'); metric('Écart au marché', d.ecart_marche_pct, '%'); metric('Annonces comparables', first(d, 'nb_annonces_comparables', 'listings_count'));
      model.summary = text(d.verdict) ?? text(d.quick_verdict) ?? model.summary; note('Référence d’annonces : ne se confond pas avec les prix des ventes DVF.'); break;
    case 'get_veille_marche':
      metric('Annonces actives', d.annonces_actives); metric('Nouvelles annonces · 7 jours', d.nouvelles_7j); metric('Prix médian demandé', d.prix_median_m2_demande, '€/m²'); metric('Délai médian observé', d.delai_median_vente_jours, 'jours');
      note('Prix demandés en annonce, pas des prix de ventes réalisées.'); break;
    case 'recherche_biens':
      metric('Biens retournés', d.count);
      table('Annonces repérées', d.biens, [['Ville', ['ville']], ['Prix demandé', ['prix'], '€'], ['Surface', ['surface'], 'm²'], ['Prix demandé / m²', ['prix_m2'], '€/m²']], ['url']); note('Annonces en ligne : disponibilité à vérifier et prix demandés distincts des ventes DVF.'); break;
    case 'get_loyers_reference':
      metric('Appartements', first(s, 'loyer_median_appartement', 'appartement.median'), '€/m²/mois'); metric('Maisons', first(s, 'loyer_median_maison', 'maison.median'), '€/m²/mois'); metric('Observations', s.nb_observations);
      table('Par arrondissement', d.arrondissements, [['Commune', ['commune_nom']], ['Appartement', ['loyer_median_appartement'], '€/m²/mois'], ['Maison', ['loyer_median_maison'], '€/m²/mois']]);
      note('Loyers résidentiels de référence ; ne constituent pas des recettes hôtelières.'); if (s.loyer_median_global_estime === true) note('La référence globale est estimée ; les valeurs par type restent distinctes.'); break;
    case 'get_analyse_predictive': {
      const p = record(d.projection), spot = record(p.spot);
      metric('Valeur actuelle estimée', spot.marketValue, '€'); metric('Prix estimé', spot.pricePerSqm, '€/m²');
      const horizons = ['6', '12', '18', '24', '36', '60'];
      table('Projections centrales', horizons.flatMap((h) => {
        const value = record(at(p, `forecast.horizon${h}m`));
        return Object.keys(value).length ? [{ horizon: `${h} mois`, ...value }] : [];
      }), [['Horizon', ['horizon']], ['Valeur estimée', ['marketValue'], '€'], ['Prix estimé', ['pricePerSqm'], '€/m²'], ['Évolution', ['deltaPercent'], '%']]);
      model.summary = text(at(p, 'summary.explanation')) ?? model.summary;
      note('Projection du modèle, pas une valeur de vente garantie. Les hypothèses et les données manquantes doivent être examinées.');
      if (Array.isArray(d.entrees_manquantes) && d.entrees_manquantes.length) note(`Entrées manquantes : ${d.entrees_manquantes.filter((v) => typeof v === 'string').join(', ')}.`);
      break;
    }
    case 'get_risks_georisques':
      metric('Score de sécurité', at(d, 'scores_securite.global'), '/100', '100 = sécurité élevée, pas risque élevé'); metric('Critères mesurés', at(d, 'confiance.criteres_mesures')); metric('Critères attendus', at(d, 'confiance.criteres_total'));
      bars('Sécurité par domaine · 100 = sécurité élevée', Object.fromEntries(Object.entries(record(d.scores_securite)).filter(([key]) => key !== 'global')), '/100', 100);
      table('Catégories de risques', d.categories, [['Catégorie', ['nom']], ['Niveau de risque', ['niveau_risque']], ['Sécurité', ['score_securite'], '/100']]);
      table('Points relevés', d.insights, [['Thème', ['categorie']], ['Constat', ['message']]]);
      note('La sécurité ne garantit pas l’absence de risque. Les catégories non mesurées restent à vérifier.'); break;
    case 'get_dpe_ademe':
      metric('Diagnostics recensés', s.total); metric('Diagnostics F ou G', s.nb_passoires_fg); metric('Diagnostic le plus récent', s.plus_recent);
      for (const [key, title] of [['distribution_dpe', 'Répartition des classes énergie'], ['distribution_ges', 'Répartition des classes climat / GES']]) {
        const items = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].flatMap((label) => { const v = number(record(s[key])[label]); return v !== null && v >= 0 ? [{ label, value: v, tone: label }] : []; });
        if (items.length) model.charts.push({ title, unit: 'diagnostics', items });
      }
      note('Répartition des diagnostics retournés par l’API, pas la classe certifiée de chaque bâtiment. Base ADEME non exhaustive.'); break;
    case 'get_batiment_bdnb': {
      const b = record(d.batiment_principal); metric('Construction', number(b.annee_construction) !== null ? String(b.annee_construction) : b.annee_construction); metric('Niveaux', b.nb_niveaux); metric('Logements', b.nb_logements); metric('Emprise au sol', b.emprise_sol_m2, 'm²');
      table('Caractéristiques', [{ label: 'Usage', value: b.usage }, { label: 'Murs', value: b.materiau_murs }, { label: 'Toiture', value: b.materiau_toit }, { label: 'DPE représentatif', value: b.classe_dpe_representative }], [['Caractéristique', ['label']], ['Valeur', ['value']]]); note('Données de référence BDNB ; les champs non renseignés ne sont pas déduits.'); break;
    }
    case 'get_assainissement':
      metric('Service collectif communal', s.ac_present); metric('Service non collectif communal', s.anc_present);
      metric('Service collectif', s.ac_service); metric('Service non collectif', s.anc_service);
      note('Un service communal ne confirme pas le raccordement ni la capacité du réseau pour cette parcelle.'); break;
    case 'get_parcel_plu': case 'get_zonage_plu': {
      const zone = record(d.zone_principale), rules = record(d.regles);
      metric('Zone', d.zone_code ?? first(zone, 'libelle', 'code', 'zone_code')); metric('Hauteur maximale', rules.hauteur_max_m, 'm');
      const ratio = number(rules.emprise_sol_max_ratio); metric('Emprise maximale', ratio !== null && ratio >= 0 && ratio <= 1 ? ratio * 100 : null, '%');
      metric('Recul sur voie', rules.recul_voirie_m, 'm'); metric('Recul séparatif', rules.recul_limites_m, 'm'); metric('Stationnement', rules.stationnement_par_logement, 'place(s)/logement');
      table('Zones intersectées', d.zones, [['Zone', ['libelle', 'code']], ['Désignation', ['libelle_long', 'nom']], ['Type', ['type_zone', 'typezone']]]);
      if (!Object.keys(rules).length) note('Zonage seul : les règles de hauteur, d’emprise et de stationnement ne sont pas connues.');
      note('La zone seule ne valide pas la constructibilité du projet ; vérifier le règlement et les contraintes applicables.'); break;
    }
    case 'get_parcel_summary': case 'get_parcelle_depuis_adresse': case 'get_etude_parcelle': {
      const p = record(d.parcelle), a = record(d.adresse);
      metric('Référence cadastrale', first(d, 'cadastral_ref', 'parcel_id') ?? p.idu); metric('Surface cadastrale', first(d, 'surface_m2', 'surface') ?? first(p, 'contenance_m2', 'surface_m2'), 'm²');
      metric('Commune', a.commune ?? first(p, 'commune_nom', 'commune') ?? first(d, 'commune.commune_nom', 'commune')); metric('Zone', d.plu_zone);
      table('Sources de l’étude', d.donnees, [['Domaine', ['domaine']], ['Résultat', ['resume']], ['Disponibilité', ['statut']], ['Organisme', ['organisme']]]);
      note('La parcelle détectée au point d’adresse ne confirme pas le périmètre de toute la propriété.'); break;
    }
    case 'get_couts_construction':
      metric('Budget de référence', s.cout_total_ht, '€ HT'); metric('Coût unitaire', s.cout_m2_sdp_ht, '€/m² SDP HT'); metric('Surface SDP', s.surface_sdp_m2, 'm²');
      table('Fourchette estimative', [s], [['Borne basse', ['cout_total_min'], '€ HT'], ['Borne haute', ['cout_total_max'], '€ HT']]); note('Barème estimatif, à confirmer par devis. Foncier, honoraires, taxes et autres exclusions sont à vérifier.'); break;
    case 'get_couts_renovation':
      metric('Budget bas', s.total_bas, '€ HT'); metric('Budget haut', s.total_haut, '€ HT'); metric('Surface habitable', s.surface_habitable_m2, 'm²'); metric('Aléas provisionnés', s.alea_pct, '%');
      if (Array.isArray(s.postes)) {
        const items = s.postes.flatMap((item) => { const row = record(item), value = number(row.cout_haut), label = text(row.libelle) ?? text(row.poste); return value !== null && value >= 0 && label ? [{ label, value }] : []; });
        if (items.length) model.charts.push({ title: 'Budgets par poste · bornes hautes', unit: '€ HT', items });
      }
      table('Budget par poste', s.postes, [['Poste', ['libelle', 'poste']], ['Bas', ['cout_bas'], '€ HT'], ['Haut', ['cout_haut'], '€ HT']]); note('Ordres de grandeur issus du barème, pas des devis.'); break;
    case 'get_equipements_proches':
      metric('Équipements recensés', d.total_dans_rayon); bars('Équipements par catégorie', d.par_categorie, 'équipements');
      table('Équipements les plus proches', d.equipements_les_plus_proches, [['Équipement', ['nom']], ['Catégorie', ['categorie']], ['Distance', ['distance_m'], 'm']]); break;
    case 'get_etablissements_proches':
      metric('Établissements dans le rayon', d.total_dans_rayon); metric('Établissements analysés', d.analyses); metric('Créations sur 12 mois', d.creations_recentes_12m);
      bars('Répartition NAF de l’échantillon', d.par_section_naf, 'établissements');
      table('Établissements repérés', d.etablissements_proches, [['Nom', ['nom', 'nom_complet']], ['Activité', ['activite_principale', 'code_naf']], ['Distance', ['distance_m'], 'm']]); break;
    case 'get_operateurs_candidats':
      metric('Entreprises retournées', Array.isArray(d.candidats) ? d.candidats.length : null); metric('Programme', d.programme);
      table('Entreprises à qualifier', d.candidats, [['Entreprise', ['nom']], ['SIREN', ['siren']], ['Implantation', ['implantation_departementale.commune']], ['Activité', ['activite_principale']]], ['fiche_officielle']);
      note('Présence et activité déclarées ; intérêt pour le projet et capacité d’investissement non confirmés.'); break;
    case 'get_proprietaire_parcelle':
      metric('Référence cadastrale', d.idu); metric('Titulaires recensés', d.nombre_titulaires);
      table('Personnes morales recensées', d.proprietaires, [['Dénomination', ['denomination']], ['SIREN', ['siren']], ['Droit', ['code_droit']], ['Commune', ['commune']]]);
      note(d.note_siren); note(d.note_pluralite); note('Le référentiel porte sur les personnes morales. Une absence de résultat ne permet pas de conclure sur un propriétaire particulier.'); break;
    case 'get_contacts_mairies':
      metric('Mairies trouvées', d.total_trouve); metric('Contacts retournés', d.nombre_retourne);
      table('Coordonnées disponibles', d.mairies, [['Commune', ['commune']], ['Maire', ['maire']], ['Courriel', ['email']], ['Téléphone', ['telephone']]]); break;
    case 'get_appels_offres': case 'lister_nouveautes_appels_offres':
      metric('Avis retournés', s.total ?? d.total); metric('Échéances proches', s.urgents ?? d.urgents); metric('Zone d’exécution incertaine', s.zone_incertaine ?? d.zone_incertaine);
      table('Avis et échéances', d.items ?? d.avis, [['Objet', ['objet']], ['Acheteur', ['acheteur']], ['Date limite', ['date_limite_reponse', 'date_limite']], ['Jours restants', ['jours_restants']]], ['url']);
      note('La diffusion d’un avis dans un département ne confirme pas le lieu d’exécution du chantier. Vérifier les pièces de l’avis.'); break;
    case 'lister_watchlists': case 'lister_zones_veille': case 'lister_veilles_appels_offres':
      metric('Recherches retournées', d.total ?? d.actives); metric('Recherches inactives', d.inactives);
      table('Recherches enregistrées', d.watchlists ?? d.zones ?? d.veilles, [['Nom', ['name', 'label']], ['Zone', ['city', 'departements']], ['Active', ['is_active']]]);
      note(d.note_alerte); break;
    case 'get_sitadel':
      metric('Permis dans le rayon', d.total_dans_rayon); metric('Permis analysés', d.analyses); metric('Logements sur les permis analysés', d.logements_crees_sur_analyses);
      bars('Types des permis analysés', d.par_type_sur_analyses, 'permis'); table('Permis récents', d.plus_recents, [['Date', ['date']], ['Type', ['type']], ['Commune', ['commune']], ['Logements', ['logements']]]); note(d.note_comptage); break;
    case 'get_logement_social':
      metric('Logements sociaux', d.logements_sociaux); metric('Part de logements sociaux', d.taux_lls_pct, '%'); metric('Objectif communal', d.objectif_sru_pct, '%'); metric('Demandes en attente', d.demandes_en_attente); note('Données communales, pas la part de logement social imposée à cette opération.'); break;
    case 'get_taxes_locales':
      metric('Taxe foncière bâtie · taux', s.taxe_fonciere_batie_pct, '%'); metric('Taxe foncière non bâtie · taux', s.taxe_fonciere_non_batie_pct, '%'); metric('TEOM · taux', s.teom_pct, '%');
      note('Taux relevés, pas le montant de votre avis fiscal. Un montant exige les bases imposables et les parts applicables.'); break;
    case 'get_dispositif_fiscal': {
      const result = record(d.resultat), fiche = record(d.fiche);
      metric('Dispositif', fiche.libelle ?? result.libelle ?? d.nom);
      if (typeof d.eligible === 'boolean') metric('Conditions du moteur remplies', d.eligible);
      model.summary = text(fiche.resume) ?? model.summary;
      if (d.eligible === true) { metric('Avantage de la première année', result.avantageAnnuelEur, '€'); metric('Avantage cumulé', result.avantageTotalEur, '€'); }
      table('Conditions et réserves', result.constats, [['Niveau', ['niveau']], ['Constat', ['message']]]);
      table('Dispositifs ouverts', d.dispositifs_ouverts, [['Dispositif', ['libelle']], ['Description', ['resume']]]);
      note(d.avertissement_tmi); note(d.mention_obligatoire);
      if (d.eligible === false) { model.state = 'partial'; note('Une condition bloquante est relevée : aucun avantage fiscal acquis n’est affiché.'); }
      if (d.statut === 'dispositif_clos') { model.state = 'partial'; metric('Fermé aux nouveaux investisseurs depuis', d.ferme_depuis); }
      note('Simulation selon les paramètres déclarés ; les conditions non vérifiées restent à confirmer.'); break;
    }
    case 'get_potentiel_solaire':
      metric('Production spécifique', s.production_specifique_kwh_kwc_an, 'kWh/kWc/an'); metric('Irradiation', s.irradiation_plan_kwh_m2_an, 'kWh/m²/an'); metric('Inclinaison optimale', s.inclinaison_optimale_deg, '°');
      if (Array.isArray(d.production_mensuelle)) { const items = d.production_mensuelle.flatMap((item) => { const row = record(item), v = number(row.production_kwh_kwc), label = text(row.mois); return v !== null && v >= 0 && label ? [{ label, value: v }] : []; }); if (items.length) model.charts.push({ title: 'Production mensuelle pour 1 kWc', unit: 'kWh/kWc', items }); }
      note(s.limite); note('Estimation de production pour 1 kWc, pas la production totale d’une toiture.'); break;
    case 'get_altimetrie':
      metric('Altitude', s.altitude_m, 'm'); metric('Pente estimée', s.pente_pct, '%'); metric('Angle de pente', s.pente_deg, '°'); break;
    case 'get_zonage_abc': metric('Zone ABC', s.zone ?? s.zone_abc); note('Zonage de politique du logement, distinct du zonage PLU et de la constructibilité.'); break;
    case 'get_monuments_historiques':
      metric('Monuments retournés', s.total); metric('Distance au plus proche', s.distance_plus_proche_m, 'm');
      table('Monuments recensés', d.monuments, [['Monument', ['nom', 'titre']], ['Protection', ['protection', 'statut']], ['Distance', ['distance_m'], 'm']]); note('Une proximité de 500 m ne prouve pas à elle seule les obligations applicables ; vérifier les abords et les périmètres délimités.'); break;
    case 'get_servitudes': table('Servitudes recensées', d.servitudes, [['Servitude', ['libelle', 'nom', 'type']], ['Catégorie', ['categorie', 'code']]]); note('Une absence de résultat au GPU ne prouve pas l’absence de servitude.'); break;
    case 'get_prescriptions_urbanisme':
      metric('Prescriptions retournées', d.nb_prescriptions); metric('Prescriptions signalées', d.nb_prescriptions_impactantes);
      table('Prescriptions du GPU', d.prescriptions, [['Prescription', ['libelle', 'nom']], ['Portée', ['portee']], ['Lecture indicative', ['enjeu_probable']]]); note('L’enjeu probable est une lecture indicative, à confronter au règlement écrit.'); break;
    case 'get_ppr_detail': table('Plans de prévention', d.ppr, [['Plan', ['nom', 'nom_ppr']], ['Risque', ['risques', 'risque']], ['Statut', ['statut']], ['Date', ['date_approbation']]]); note('Le périmètre d’un PPR ne donne pas ici sa zone réglementaire rouge ou bleue.'); break;
    case 'get_classement_sonore': table('Secteurs sonores', d.secteurs, [['Voie / secteur', ['libelle', 'nom']], ['Catégorie', ['categorie']], ['Largeur', ['largeur_secteur_m', 'largeur_m'], 'm']]); break;
    case 'get_contexte_commune': model.summary = text(d.description) ?? text(d.summary); note('Contexte encyclopédique ; ne constitue pas une source réglementaire ou une étude de marché.'); break;
    case 'get_bilan_promoteur':
      metric('Recettes prévisionnelles', d.ca_previsionnel_eur, '€'); metric('Prix de revient', d.prix_revient_total_eur, '€'); metric('Résultat enregistré', d.marge_nette_eur, '€'); metric('Marge sur CA', d.taux_marge_nette_pct, '%'); note('Lecture du bilan enregistré, sans nouveau calcul.'); break;
    default: break;
  }
  // Complément pour les contrats de listes et les API secondaires, sans JSON brut.
  if (!model.tables.length) {
    const lists = ['contacts', 'mairies', 'proprietaires', 'avis', 'items', 'biens', 'zones', 'watchlists', 'veilles', 'secteurs', 'ppr'];
    for (const key of lists) if (Array.isArray(d[key]) && (d[key] as unknown[]).length) {
      table(labelOf(key), d[key], [['Nom / objet', ['nom', 'titre', 'objet', 'name', 'raison_sociale']], ['Commune', ['commune', 'city']], ['Information', ['statut', 'adresse', 'date_limite']]]); break;
    }
  }
  if (!model.metrics.length && !model.tables.length && !model.charts.length) {
    for (const [key, raw] of Object.entries({ ...s, ...d })) {
      if (model.metrics.length >= 6) break;
      if (['summary', 'source', 'url', 'intro', 'empty', 'avertissement', 'note', 'message'].includes(key) || /token|secret|uuid|^_|id$|consigne|instruction/i.test(key)) continue;
      if (typeof raw === 'number' && Number.isFinite(raw) || typeof raw === 'boolean' || typeof raw === 'string' && raw.length < 100 && !safeSourceUrl(raw)) metric(labelOf(key), raw);
    }
  }
  if (d.affichage_tronque === true) note('Les listes et répartitions portent sur l’échantillon retourné, qui peut être inférieur au total recensé.');
  if (model.state === 'ready' && model.metrics.some((metric) => metric.value === 'Non renseigné')) model.state = 'partial';
  if (model.state === 'empty') note('Aucun résultat exploitable dans ce périmètre ne signifie pas que l’objet ou la contrainte n’existe pas.');
  return model;
}
