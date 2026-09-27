import { calculateOperatingModel, emptyOperatingInputs, type OperatingInputs } from './operatingModel';
import { programmeKind } from './projectProgramme';

const money = (value: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value)} €`;
const pct = (value: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)} %`;
const UNIT_LABELS = {
  hotel: 'chambre disponible', ehpad: 'place disponible', clinic: 'unité de service', retail: 'unité de vente',
  office: 'lot disponible', student: 'logement disponible', housing: 'logement disponible', other: 'unité disponible',
} as const;

export function OperatingModelSection({ programme, units, totalCost, value, onChange }: {
  programme: string; units: string; totalCost: string; value?: OperatingInputs; onChange: (next: OperatingInputs) => void;
}) {
  const model = { ...emptyOperatingInputs(), ...value };
  const result = calculateOperatingModel(units, model);
  const kind = programmeKind(programme);
  const patch = (name: keyof OperatingInputs, next: string) => onChange({ ...model, [name]: next });
  const field = (name: Exclude<keyof OperatingInputs, 'period'>, label: string, suffix: string) => <label className="text-sm font-medium text-slate-700">{label}<div className="mt-1 flex items-center rounded-xl border border-slate-300"><input type="number" min="0" max={name.toLowerCase().includes('pct') ? '100' : undefined} step="any" value={model[name]} onChange={(event) => patch(name, event.target.value)} className="w-full min-w-0 rounded-xl px-3 py-2.5 font-normal" /><span className="shrink-0 pr-3 text-xs text-slate-500">{suffix}</span></div></label>;
  const cost = Number(totalCost.replace(',', '.'));
  const costYield = result && Number.isFinite(cost) && cost > 0 ? result.prudent.operatingSurplus / cost * 100 : null;
  return <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-7">
    <h3 className="text-lg font-semibold">Exploitation · scénario central et prudent</h3>
    <p className="mt-2 text-sm text-slate-600">Construisez une hypothèse à partir du nombre d’unités indiqué plus haut. Saisissez les recettes et charges propres à l’usage étudié ; aucun taux ni prix n’est inventé. Les montants de ce modèle ne sont pas repris comme valeur de cession.</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-sm font-medium text-slate-700">Période de vente par {UNIT_LABELS[kind]}<select value={model.period} onChange={(event) => patch('period', event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal"><option value="jour">Jour · 365 périodes/an</option><option value="mois">Mois · 12 périodes/an</option><option value="an">An · 1 période/an</option></select></label>
      {field('unitRevenue', 'Recette par unité occupée et par période', '€')}
      {field('occupancyPct', 'Occupation centrale', '%')}
      {field('prudentOccupancyPct', 'Occupation prudente', '%')}
      {field('prudentPriceCutPct', 'Baisse de prix du cas prudent', '%')}
      {field('variableCostPerUnit', 'Coût variable par unité occupée et par période', '€')}
      {field('ancillaryRevenueYear', 'Autres recettes annuelles', '€/an')}
      {field('fixedCostsYear', 'Charges fixes annuelles, personnel compris', '€/an')}
      {field('maintenanceYear', 'Réserve annuelle d’entretien', '€/an')}
    </div>
    {result ? <><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[480px] text-left text-sm"><thead><tr className="border-b text-slate-500"><th className="pb-2">Hypothèse</th><th>Recettes annuelles</th><th>Solde d’exploitation annuel</th><th>Marge d’exploitation</th></tr></thead><tbody><tr className="border-b border-slate-100"><td className="py-2">Centrale</td><td>{money(result.central.revenue)}</td><td className={result.central.operatingSurplus < 0 ? 'font-semibold text-rose-700' : 'font-semibold text-emerald-700'}>{money(result.central.operatingSurplus)}</td><td>{pct(result.central.marginPct)}</td></tr><tr><td className="py-2">Prudente</td><td>{money(result.prudent.revenue)}</td><td className={result.prudent.operatingSurplus < 0 ? 'font-semibold text-rose-700' : 'font-semibold text-emerald-700'}>{money(result.prudent.operatingSurplus)}</td><td>{pct(result.prudent.marginPct)}</td></tr></tbody></table></div><p className="mt-3 text-sm text-slate-700">Seuil d’occupation du cas prudent : <strong>{result.breakEvenOccupancyPct == null ? 'inatteignable avec cette recette unitaire' : result.breakEvenOccupancyPct > 100 ? `supérieur à 100 % (${pct(result.breakEvenOccupancyPct)})` : pct(Math.max(0, result.breakEvenOccupancyPct))}</strong>. {costYield != null ? <>Solde prudent / coût complet déclaré : <strong>{pct(costYield)}</strong> avant financement et impôts.</> : 'Renseignez le coût complet pour mesurer le rapport entre solde prudent et investissement.'}</p>
      {result.prudent.operatingSurplus <= 0 && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-900">Avec ces hypothèses, l’exploitation prudente ne couvre pas ses charges annuelles : revoir le programme, les prix ou les coûts avant de le retenir.</p>}
    </> : <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Renseignez tous les champs, dont les valeurs nulles, pour calculer l’exploitation. L’occupation prudente doit être inférieure ou égale à l’occupation centrale.</p>}
    <p className="mt-3 text-xs text-slate-500">Modèle annuel simplifié : unités × périodes × occupation × prix + autres recettes − coûts variables − charges fixes − entretien. Pour un EHPAD, une clinique ou un commerce, la tarification, les activités, les effectifs et la propriété des murs doivent être détaillés avec l’opérateur. Pour une cession, obtenir une offre ou une valorisation documentée distincte.</p>
  </div>;
}
