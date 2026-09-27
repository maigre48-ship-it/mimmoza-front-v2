import { ExternalLink } from 'lucide-react';
import type { HotelBasin } from './hotelBasin';

const rankLabel: Record<string, string> = { NC: 'Non classé', '1': '1 étoile', '2': '2 étoiles', '3': '3 étoiles', '4': '4 étoiles', '5': '5 étoiles' };
const count = (value: number) => new Intl.NumberFormat('fr-FR').format(value);

export function HotelBasinSection({ basin }: { basin: HotelBasin | null | undefined }) {
  if (!basin) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">L’offre hôtelière des communes voisines n’a pas encore été relevée. Relancez l’analyse pour compléter le bassin concurrentiel.</div>;
  const hotels = basin.rows.reduce((sum, row) => sum + row.hotels, 0);
  const rooms = basin.rows.reduce((sum, row) => sum + row.rooms, 0);
  const ranks = ['NC', '1', '2', '3', '4', '5'].map((rank) => ({ rank, rooms: basin.rows.reduce((sum, row) => sum + (row.roomsByRanking[rank] ?? 0), 0), published: basin.rows.filter((row) => row.roomsByRanking[rank] != null).length }));
  const max = Math.max(1, ...ranks.map((row) => row.rooms));
  const complete = basin.measuredCommunes === basin.selectedCommunes;

  return <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-7">
    <h3 className="text-lg font-semibold text-slate-900">Offre concurrente dans les communes proches</h3>
    <p className="mt-1 text-sm text-slate-600">Communes du même département dont le centre est situé à 15 km au plus du centre de la commune étudiée ; au plus 20 communes. Capacité INSEE {basin.year}.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl bg-indigo-50 p-3"><strong className="text-xl text-indigo-950">{count(hotels)}</strong><p className="text-xs text-indigo-800">hôtels relevés{complete ? '' : ' · total partiel'}</p></div>
      <div className="rounded-xl bg-indigo-50 p-3"><strong className="text-xl text-indigo-950">{count(rooms)}</strong><p className="text-xs text-indigo-800">chambres relevées{complete ? '' : ' · total partiel'}</p></div>
      <div className="rounded-xl bg-slate-50 p-3"><strong className="text-xl text-slate-900">{basin.measuredCommunes}/{basin.selectedCommunes}</strong><p className="text-xs text-slate-600">communes avec données</p></div>
    </div>
    {basin.rows.length > 0 && <>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div><h4 className="text-sm font-semibold text-slate-800">Chambres par classement publiées</h4><div className="mt-3 space-y-2">{ranks.map(({ rank, rooms: rankRooms, published }) => <div key={rank} className="grid grid-cols-[6rem_1fr_3rem] items-center gap-2 text-xs"><span>{rankLabel[rank]}</span><div className="h-4 rounded bg-slate-100"><div className="h-4 rounded bg-indigo-500" style={{ width: `${rankRooms / max * 100}%` }} /></div><strong className="text-right">{published ? count(rankRooms) : '—'}</strong></div>)}</div><p className="mt-2 text-xs text-slate-500">Somme des seules catégories publiées ; un tiret indique l’absence de donnée. Les classements absents ou non publiés ne constituent pas une opportunité démontrée.</p></div>
        <div className="max-h-64 overflow-auto"><h4 className="text-sm font-semibold text-slate-800">Communes et capacité publiée</h4><table className="mt-2 w-full text-left text-xs"><thead><tr className="border-b text-slate-500"><th className="py-2">Commune</th><th>Distance</th><th>Hôtels</th><th>Chambres</th><th>Source</th></tr></thead><tbody>{basin.rows.map((row) => <tr key={row.insee} className="border-b border-slate-100"><td className="py-2 font-medium">{row.name}</td><td>{row.distanceKm.toLocaleString('fr-FR')} km</td><td>{count(row.hotels)}</td><td>{count(row.rooms)}</td><td><a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`Données INSEE pour ${row.name}`} className="text-indigo-700 underline"><ExternalLink size={13} /></a></td></tr>)}</tbody></table></div>
      </div>
    </>}
    <p className="mt-4 text-xs text-slate-600">Périmètre indicatif : distances entre centres communaux, et non depuis la parcelle. Les hôtels des communes non sélectionnées, les communes d’autres départements et l’offre transfrontalière ne sont pas inclus. Ces capacités ne mesurent ni les prix, ni le remplissage, ni les motifs de séjour ou la demande pour le projet. <a href={basin.communeSourceUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-700 underline">Centres communaux : API Géo</a>.</p>
  </div>;
}
