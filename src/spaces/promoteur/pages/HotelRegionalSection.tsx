import type { HotelEvidence } from './hotelMarket';
import { hotelTerritorialSignals } from './hotelTerritorialSignals';

const REGION_NAMES: Record<string, string> = {
  '01': 'Guadeloupe', '02': 'Martinique', '03': 'Guyane', '04': 'La Réunion', '06': 'Mayotte',
  '11': 'Île-de-France', '24': 'Centre-Val de Loire', '27': 'Bourgogne-Franche-Comté',
  '28': 'Normandie', '32': 'Hauts-de-France', '44': 'Grand Est', '52': 'Pays de la Loire',
  '53': 'Bretagne', '75': 'Nouvelle-Aquitaine', '76': 'Occitanie',
  '84': 'Auvergne-Rhône-Alpes', '93': 'Provence-Alpes-Côte d’Azur', '94': 'Corse',
};
const RANK_LABEL: Record<string, string> = { NC: 'Non classés', '1T2': '1 et 2 étoiles', '3': '3 étoiles', '4T5': '4 et 5 étoiles' };
const number = (value: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value);

export function HotelRegionalSection({ evidence }: { evidence: HotelEvidence }) {
  const regionCode = evidence.codeRegion;
  const demand = evidence.regionalDemand;
  const signals = hotelTerritorialSignals(regionCode, evidence.department, evidence.communeInsee);
  if (!regionCode) return null;
  const region = REGION_NAMES[regionCode] ?? `région ${regionCode}`;
  return <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-7">
    <h3 className="text-lg font-semibold text-slate-900">Profil hôtelier régional · {region}</h3>
    <p className="mt-1 text-sm text-slate-600">La répartition des nuitées complète l’offre communale et la saisonnalité départementale. Elle décrit les hôtels existants, pas un programme optimal pour le terrain.</p>
    {demand ? <>
      <p className="mt-4 text-sm text-slate-700"><strong>{number(demand.totalNights)} nuitées</strong> dans les hôtels de {region} en {demand.year} · <a className="text-indigo-700 underline" href={demand.sourceUrl} target="_blank" rel="noopener noreferrer">données INSEE Melodi</a></p>
      {demand.rankings.length === 4 ? <div className="mt-4 space-y-3">{demand.rankings.map((item) => {
        const share = item.nights / demand.totalNights * 100;
        return <div key={item.ranking}><div className="mb-1 flex justify-between gap-3 text-sm"><span>{RANK_LABEL[item.ranking]}</span><strong>{number(item.nights)} nuitées · {number(share)} %</strong></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(0, Math.min(100, share))}%` }} /></div></div>;
      })}</div> : <p className="mt-3 text-sm text-amber-800">La ventilation par classement est incomplète dans la source pour ce millésime.</p>}
      <p className="mt-3 text-xs text-slate-500">Nuitées, et non chambres vendues ou taux d’occupation. Le regroupement « classés » de l’INSEE recoupe les catégories affichées et n’est pas additionné.</p>
    </> : <p className="mt-4 text-sm text-slate-600">La série annuelle par classement n’est pas disponible pour cette région ou ce millésime.</p>}
    {signals.length > 0 && <div className="mt-6 border-t border-slate-200 pt-5"><h4 className="font-semibold text-slate-900">Éclairage de l’observatoire territorial</h4><div className="mt-3 grid gap-3 sm:grid-cols-2">{signals.map((signal) => <div key={signal.label} className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{signal.label}</p><p className="mt-1 text-xl font-semibold text-slate-900">{signal.value}</p><p className="text-xs text-slate-600">{signal.perimeter} · {signal.period ?? signal.year} · <a className="text-indigo-700 underline" href={signal.sourceUrl} target="_blank" rel="noopener noreferrer">{signal.source}</a>{signal.updatesUrl && <> · <a className="text-indigo-700 underline" href={signal.updatesUrl} target="_blank" rel="noopener noreferrer">Baromètres récents</a></>}</p><p className="mt-2 text-xs text-slate-600">{signal.implication}</p></div>)}</div></div>}
    <p className="mt-5 rounded-xl bg-amber-50 p-3 text-xs text-amber-950">Une part régionale de nuitées élevée ne suffit pas à choisir une catégorie d’hôtel. Il faut comparer les établissements du bassin, leurs prix, leurs services et leur occupation, puis vérifier l’intérêt d’exploitants.</p>
  </section>;
}
