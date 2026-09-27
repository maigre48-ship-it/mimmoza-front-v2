import { hotelBenchmarkForEpci } from './hotelBasqueBenchmark';

const label = (month: string) => new Date(`${month}-01T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

export function HotelLocalBenchmarkSection({ codeEpci }: { codeEpci: string | null | undefined }) {
  const rows = hotelBenchmarkForEpci(codeEpci);
  if (!rows.length) return null;
  return <div className="rounded-3xl border border-indigo-200 bg-white p-5 sm:p-7">
    <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Enquête locale · ADT64</p>
    <h3 className="mt-1 text-lg font-semibold text-slate-900">Occupation et prix observés au Pays basque</h3>
    <p className="mt-2 text-sm text-slate-600">Baromètres mensuels d’hôtels répondants : ces chiffres décrivent les établissements de l’enquête à l’échelle du Pays basque, pas la parcelle ni un hôtel futur.</p>
    <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[540px] text-left text-sm"><thead><tr className="border-b border-slate-200 text-slate-500"><th className="py-2">Mois publié</th><th>Hôtels répondants</th><th>Occupation</th><th>Prix moyen / chambre</th><th>Revenu / chambre</th><th>Source</th></tr></thead><tbody>{rows.map((row) => <tr key={row.month} className="border-b border-slate-100"><td className="py-2 font-medium capitalize">{label(row.month)}</td><td>{row.respondents}</td><td>{row.occupancyPct} %</td><td>{row.adrEuro} €</td><td>{row.revparEuro} €</td><td><a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-700 underline">PDF ADT64</a></td></tr>)}</tbody></table></div>
    <p className="mt-3 text-xs text-slate-600">Relevé des PDF vérifié le 27/09/2026 ; les nouvelles éditions ne sont pas ajoutées automatiquement. Seuls les mois vérifiés figurent ici ; les mois manquants ne sont pas estimés. Les hôtels répondants peuvent changer d’un mois à l’autre. Aucun taux annuel, chiffre d’affaires prévisionnel ou prix propre au projet n’est calculé à partir de cette série incomplète.</p>
    <p className="mt-2 text-xs text-slate-600">L’<a href="https://pro.tourisme64.com/resultats-de-lenquete-de-clientele-en-bearn-et-pays-basque/" target="_blank" rel="noopener noreferrer" className="text-indigo-700 underline">enquête de clientèle de l’ADT64</a> décrit les visiteurs du Pays basque, leurs pratiques et attentes. Elle ne mesure pas la part de ces clientèles qui réserverait cet établissement.</p>
  </div>;
}
