import { buildMarketDepth } from './marketDepth';
import type { SectorSnapshot } from './sectorScreening';

const money = (value: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
const number = (value: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value);

export function MarketDepthSection({ snapshot }: { snapshot: SectorSnapshot }) {
  const dossier = buildMarketDepth(snapshot);
  return <section aria-labelledby="market-depth-title" className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-7">
    <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Étude de marché détaillée</p>
    <h3 id="market-depth-title" className="mt-1 text-xl font-semibold text-slate-900">{dossier.label} · demande, offre et prix</h3>
    <p className="mt-2 text-sm text-slate-700"><strong>Cible à vérifier :</strong> {dossier.target} <strong>Programme à tester :</strong> {dossier.programme}</p>
    <p className={`mt-3 rounded-xl p-3 text-sm ${dossier.observedActivity ? 'bg-indigo-50 text-indigo-950' : 'bg-amber-50 text-amber-950'}`}>{dossier.observedActivity
      ? 'Une activité du marché est observée. Elle ne mesure pas à elle seule la demande captable par ce projet.'
      : 'Les chiffres disponibles décrivent surtout la population ou l’offre. La demande propre au projet n’est pas encore mesurée.'}</p>
    <div className="mt-5 grid gap-4 lg:grid-cols-3">{dossier.chapters.map((chapter) => <div key={chapter.title} className="rounded-2xl border border-slate-200 p-4">
      <h4 className="font-semibold text-slate-900">{chapter.title}</h4>
      {chapter.facts.length ? <ul className="mt-3 space-y-3">{chapter.facts.map((fact) => <li key={`${fact.label}-${fact.scope}`} className="border-t border-slate-100 pt-2 text-sm">
        <strong className="block text-slate-900">{fact.label} : {fact.value}</strong>
        <span className="block text-xs text-slate-600">{fact.scope} · {fact.sourceUrl ? <a href={fact.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-700 underline">{fact.source}</a> : fact.source}</span>
        <span className="mt-1 block text-xs text-slate-500">{fact.direct ? 'Activité observée sur ce marché' : 'Contexte ou offre existante ; demande du projet non déduite'}</span>
      </li>)}</ul> : <p className="mt-3 text-sm text-amber-900">Aucune mesure exploitable collectée pour ce chapitre.</p>}
      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-600">{chapter.missing}</p>
    </div>)}</div>
    {snapshot.key === 'logement' && <HousingSales snapshot={snapshot} />}
    <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-700"><strong>Pièces décisives pour la suite :</strong><ul className="mt-2 list-inside list-disc space-y-1">{dossier.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>
  </section>;
}

function HousingSales({ snapshot }: { snapshot: SectorSnapshot }) {
  const dvf = snapshot.market?.core?.dvf;
  const sales = (dvf?.coverage === 'ok' && Array.isArray(dvf.transactions) ? dvf.transactions : [])
    .filter((sale) => /^\d{4}-\d{2}-\d{2}$/.test(sale.date_mutation ?? '') && Number.isFinite(sale.valeur_fonciere) && (sale.valeur_fonciere ?? 0) > 0)
    .slice(0, 12);
  return <div className="mt-5 rounded-2xl border border-slate-200 p-4">
    <h4 className="font-semibold text-slate-900">Ventes comparables visibles</h4>
    <p className="mt-1 text-xs text-slate-600">Extrait des dernières mutations DVF renvoyées par l’étude, sur {dvf?.perimetre_label ?? 'un périmètre non documenté'}. Il ne constitue ni un échantillon exhaustif ni une estimation du prix du programme neuf. {dvf?.fenetre_label ? `Période de la statistique globale : ${dvf.fenetre_label}.` : ''}</p>
    {sales.length ? <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[590px] text-left text-sm"><thead><tr className="border-b text-slate-500"><th className="pb-2">Date</th><th>Commune</th><th>Bien</th><th>Surface bâtie</th><th>Prix signé</th><th>Prix au m²</th></tr></thead><tbody>{sales.map((sale, index) => <tr key={`${sale.date_mutation}-${index}`} className="border-b border-slate-100"><td className="py-2">{new Date(`${sale.date_mutation}T00:00:00`).toLocaleDateString('fr-FR')}</td><td>{sale.commune || '—'}</td><td>{sale.type_local || '—'}</td><td>{sale.surface_reelle_bati != null && sale.surface_reelle_bati > 0 ? `${number(sale.surface_reelle_bati)} m²` : '—'}</td><td>{money(sale.valeur_fonciere!)}</td><td>{sale.prix_m2 != null && sale.prix_m2 > 0 ? `${number(sale.prix_m2)} €/m²` : '—'}</td></tr>)}</tbody></table></div>
      : <p className="mt-3 text-sm text-amber-900">Aucune vente détaillée exploitable n’a été renvoyée. Les prix par typologie restent à collecter.</p>}
    {sales.length > 0 && <p className="mt-3 text-xs text-slate-600">Comparer uniquement des biens de type, état, surface et localisation proches du programme envisagé. Le prix médian global ne remplace pas ces comparables.</p>}
  </div>;
}
