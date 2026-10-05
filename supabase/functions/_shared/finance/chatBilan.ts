import { computeFinancialBalance } from './proForma.ts';

export const COST_FIELDS = {
  foncier_eur: 'Foncier / acquisition',
  frais_acquisition_eur: 'Frais d’acquisition',
  travaux_eur: 'Travaux, VRD et équipements',
  honoraires_eur: 'Études et honoraires',
  assurances_eur: 'Assurances',
  taxes_eur: 'Taxes de l’opération',
  commercialisation_eur: 'Commercialisation',
  financement_eur: 'Intérêts et frais de financement',
  aleas_eur: 'Provision pour aléas',
  autres_couts_eur: 'Autres coûts',
} as const;
const money = { type: 'number', minimum: 0, maximum: 1e12 };
export const CHAT_BILAN_SCHEMA = {
  type: 'object',
  properties: {
    titre: { type: 'string', description: 'Nom du projet ou de la variante.' },
    base_montants: { type: 'string', enum: ['HT', 'TTC'], description: 'Base commune confirmée par l’utilisateur. Aucune conversion de TVA implicite.' },
    recettes_eur: { ...money, description: 'Recettes totales de vente du programme, pas un revenu annuel d’exploitation.' },
    surface_vendable_m2: { type: 'number', exclusiveMinimum: 0, maximum: 1e8 },
    prix_vente_m2_eur: { ...money, description: 'Prix sur la surface vendable, dans la même base que les coûts.' },
    ...Object.fromEntries(Object.entries(COST_FIELDS).map(([key, label]) => [key, { ...money, description: `${label} : total, sans double compte. Zéro uniquement si confirmé ou explicitement exclu par l’utilisateur.` }])),
    fonds_propres_eur: { ...money, description: 'Facultatif, pour un ratio résultat / fonds propres ; ne permet pas un TRI.' },
    marge_cible_pct: { type: 'number', minimum: 0, exclusiveMaximum: 100, description: 'Facultatif, cible sur chiffre d’affaires.' },
    hypotheses: { type: 'array', items: { type: 'string' }, description: 'Hypothèses, sources des montants et exclusions explicitement acceptées. N’invente aucun montant.' },
  },
};

const round = (v: number) => Math.sign(v) * Math.round((Math.abs(v) + Number.EPSILON) * 100) / 100;
export function calculateChatBilan(input: Record<string, unknown>) {
  const source = 'Moteur partagé Bilan Mimmoza — montants déclarés, avant fiscalité du résultat';
  const missing: string[] = [];
  const invalid: string[] = [];
  const read = (key: string, label: string, required = true) => {
    const raw = input[key];
    if (raw === undefined || raw === null) { if (required) missing.push(label); return undefined; }
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1e12) { invalid.push(label); return undefined; }
    return raw;
  };
  const costs = Object.entries(COST_FIELDS).map(([key, label]) => ({ key, label, amount: read(key, label) }));
  const revenue = read('recettes_eur', 'Recettes totales de vente', false);
  const area = read('surface_vendable_m2', 'Surface vendable', false);
  const price = read('prix_vente_m2_eur', 'Prix de vente au m²', false);
  const equity = read('fonds_propres_eur', 'Fonds propres', false);
  const target = read('marge_cible_pct', 'Marge cible', false);
  if (area === 0) invalid.push('Surface vendable strictement positive');
  if (target !== undefined && target >= 100) invalid.push('Marge cible inférieure à 100 %');
  if (input.base_montants !== 'HT' && input.base_montants !== 'TTC') missing.push('Base commune des montants : HT ou TTC');
  const derivedRevenue = area !== undefined && price !== undefined ? area * price : undefined;
  const ca = revenue ?? derivedRevenue;
  if (ca === undefined) missing.push('Recettes totales de vente, ou surface vendable et prix de vente au m²');
  if (ca !== undefined && (!Number.isFinite(ca) || ca <= 0 || ca > 1e12)) invalid.push('Recettes totales de vente strictement positives et au plus 1 000 milliards d’euros');
  if (revenue !== undefined && derivedRevenue !== undefined && Math.abs(revenue - derivedRevenue) > Math.max(1, revenue * 0.001)) invalid.push('Recettes totales incohérentes avec surface × prix : préciser quelle base retenir');
  if (input.hypotheses !== undefined && (!Array.isArray(input.hypotheses) || input.hypotheses.some((v) => typeof v !== 'string'))) invalid.push('Hypothèses textuelles');
  if (invalid.length) return { status: 'error' as const, source, message: 'Corriger les données avant de calculer.', data: { invalid, missing } };
  if (missing.length) return { status: 'partial' as const, source, message: 'Demander uniquement les données manquantes. Aucun poste absent ne vaut zéro ; un bilan partiel ne permet pas de conclure sur la marge.', data: { missing, chiffres_recus: input } };

  // Même calcul de solde et de marge que la page Bilan. Aucun barème,
  // pourcentage ni intérêt forfaitaire n’est appliqué en plus des totaux.
  const amounts = Object.fromEntries(costs.map((cost) => [cost.key, cost.amount!]));
  const totalCosts = costs.reduce((sum, cost) => sum + cost.amount!, 0);
  const compute = (revenueFactor = 1, worksFactor = 1) => computeFinancialBalance(ca! * revenueFactor, totalCosts + amounts.travaux_eur * (worksFactor - 1), area);
  const pf = compute();
  const scenario = (label: string, revenueFactor: number, worksFactor: number) => {
    const result = compute(revenueFactor, worksFactor);
    return { label, recettes_eur: round(result.caTotal), cout_total_eur: round(result.coutTotal), resultat_eur: round(result.marge), marge_sur_ca_pct: round(result.margePct) };
  };
  return {
    status: 'ok' as const, source,
    message: 'Restituer ces calculs sans les recalculer. Résultat prévisionnel sur les montants déclarés, pas une validation de faisabilité ni un bénéfice net fiscal. Ne pas confondre vente immobilière et exploitation annuelle.',
    data: {
      kind: 'chat_bilan_vente_v1', titre: typeof input.titre === 'string' ? input.titre : 'Bilan prévisionnel',
      chiffres_entree: { ...amounts, recettes_eur: ca, base_montants: input.base_montants,
        ...(area !== undefined ? { surface_vendable_m2: area } : {}),
        ...(equity !== undefined ? { fonds_propres_eur: equity } : {}),
        ...(target !== undefined ? { marge_cible_pct: target } : {}) },
      base_montants: input.base_montants, postes: costs.map((cost) => ({ label: cost.label, montant_eur: round(cost.amount!) })),
      recettes_eur: round(pf.caTotal), cout_total_eur: round(pf.coutTotal), resultat_eur: round(pf.marge), marge_sur_ca_pct: round(pf.margePct),
      seuil_equilibre_recettes_eur: round(pf.coutTotal),
      ...(area ? { surface_vendable_m2: area, prix_equilibre_m2_eur: round(pf.coutTotal / area) } : {}),
      ...(equity && equity > 0 ? { fonds_propres_eur: equity, resultat_sur_fonds_propres_pct: round(pf.marge / equity * 100) } : {}),
      ...(target !== undefined ? { marge_cible_pct: target, ecart_cible_points: round(pf.margePct - target), recettes_pour_marge_cible_eur: round(pf.coutTotal / (1 - target / 100)) } : {}),
      scenarios: [scenario('Base déclarée', 1, 1), scenario('Ventes −5 %', 0.95, 1), scenario('Travaux +10 %', 1, 1.1), scenario('Ventes −5 % et travaux +10 %', 0.95, 1.1)],
      hypotheses: input.hypotheses ?? [],
      reserves: [
        'Montants déclarés : vérifier que chaque coût est complet et compté une seule fois. Le zéro est une exclusion explicite, pas une donnée manquante.',
        input.base_montants === 'TTC' ? 'Bilan en TTC : solde avant traitement de la TVA collectée et récupérable ; ce n’est pas une marge économique HT.' : 'Base HT / nette de TVA récupérable déclarée : aucune TVA n’est convertie automatiquement.',
        'Résultat avant impôt sur les bénéfices. TRI et trésorerie non calculés sans calendrier des encaissements, décaissements et financements.',
        'Sensibilités mécaniques à coûts fixes hors travaux ; elles ne prédisent pas le marché. Les aléas et autres coûts restent à leur montant déclaré.',
      ],
    },
  };
}
