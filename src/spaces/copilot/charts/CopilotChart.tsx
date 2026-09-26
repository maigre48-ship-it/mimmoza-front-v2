// =============================================================================
// Rendu d'un graphique décrit par le copilot
// -----------------------------------------------------------------------------
// recharts est déjà une dépendance déclarée du projet — on l'emploie plutôt que
// d'en introduire une seconde. Il pèse en revanche plusieurs centaines de Ko et
// n'était jusqu'ici importé nulle part : ce composant est donc chargé en `lazy`
// depuis CopilotMessage, pour ne pas l'imposer aux comptes qui n'auront jamais
// de graphique (le mode `report` est réservé à l'offre Pro).
//
// Parti pris de lecture : un graphique dans une conversation n'est pas un
// tableau de bord. Il doit se lire d'un coup d'œil, à côté du texte qui
// l'explique — donc peu de couleurs, pas de grille lourde, les valeurs écrites
// plutôt que devinées à la règle, et la SOURCE toujours visible.
// =============================================================================

import { useMemo } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { CopilotChartSpec } from './copilotChart.types';
import './CopilotChart.css';

/**
 * Palette. Une teinte dominante déclinée, plus deux accents.
 *
 * Volontairement PAS un arc-en-ciel : sur un camembert de parts de marché, dix
 * couleurs saturées empêchent de voir laquelle domine. La première teinte est
 * celle de l'accent produit ; les suivantes s'en éloignent progressivement.
 */
const PALETTE = [
  '#6d5dfc', '#4f46e5', '#0ea5e9', '#14b8a6',
  '#f59e0b', '#f97316', '#ec4899', '#64748b',
];

function formaterNombre(v: number): string {
  if (!Number.isFinite(v)) return '—';
  // Les grands nombres se lisent mieux compacts sur un axe ; le détail exact
  // reste dans l'infobulle.
  if (Math.abs(v) >= 10_000) return `${Math.round(v / 1000)} k`;
  return v.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function nomSerie(cle: string): string {
  return cle === 'value' ? 'Valeur' : cle;
}

export function CopilotChart({ spec }: { spec: CopilotChartSpec }) {
  const series = spec.series?.length ? spec.series : ['value'];
  const estCirculaire = spec.type === 'pie' || spec.type === 'donut';

  // Un camembert ne trace qu'une série : on prend la première.
  const donneesCirculaires = useMemo(
    () => spec.data.map((p) => ({ name: p.label, value: Number(p[series[0]] ?? 0) })),
    [spec.data, series],
  );

  const total = useMemo(
    () => donneesCirculaires.reduce((s, p) => s + (Number.isFinite(p.value) ? p.value : 0), 0),
    [donneesCirculaires],
  );

  // Les paramètres sont typés LARGE, comme recharts 3 les déclare
  // (`ValueType | undefined`, `NameType | undefined`). Les typer `number` /
  // `string` ferait échouer la compilation : en mode strict, les paramètres sont
  // contravariants, un type plus étroit n'est donc pas assignable.
  const infobulle = {
    contentStyle: {
      background: '#ffffff',
      border: '1px solid rgb(15 23 42 / .12)',
      borderRadius: 10,
      fontSize: 12,
      boxShadow: '0 4px 16px rgb(15 23 42 / .1)',
    },
    formatter: (
      v: number | string | ReadonlyArray<number | string> | undefined,
      nom: number | string | undefined,
    ): [string, string] => {
      const nombre = typeof v === 'number' ? v : Number(v);
      const affiche = Number.isFinite(nombre)
        ? nombre.toLocaleString('fr-FR')
        : String(v ?? '—');
      return [
        `${affiche}${spec.unit ? ` ${spec.unit}` : ''}`,
        nomSerie(String(nom ?? '')),
      ];
    },
  };

  return (
    <figure className="copilot-chart">
      {spec.title && <figcaption className="copilot-chart__title">{spec.title}</figcaption>}

      <div className="copilot-chart__canvas">
        <ResponsiveContainer width="100%" height="100%">
          {spec.type === 'line' ? (
            <LineChart data={spec.data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
              <CartesianGrid stroke="rgb(15 23 42 / .07)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={formaterNombre} width={48} />
              <Tooltip {...infobulle} />
              {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} formatter={nomSerie} />}
              {series.map((s, i) => (
                <Line
                  key={s} type="monotone" dataKey={s} name={nomSerie(s)}
                  stroke={PALETTE[i % PALETTE.length]} strokeWidth={2}
                  dot={{ r: 3 }} activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          ) : estCirculaire ? (
            <PieChart>
              <Tooltip {...infobulle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Pie
                data={donneesCirculaires}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                // L'anneau laisse la place au total au centre : sur une
                // répartition, la somme est l'information qu'on cherche ensuite.
                innerRadius={spec.type === 'donut' ? '55%' : 0}
                outerRadius="80%"
                paddingAngle={spec.type === 'donut' ? 2 : 0}
                label={({ percent }) =>
                  percent && percent > 0.06 ? `${Math.round(percent * 100)} %` : ''
                }
                labelLine={false}
              >
                {donneesCirculaires.map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Pie>
            </PieChart>
          ) : (
            <BarChart data={spec.data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
              <CartesianGrid stroke="rgb(15 23 42 / .07)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval={0} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={formaterNombre} width={48} />
              <Tooltip {...infobulle} cursor={{ fill: 'rgb(109 93 252 / .06)' }} />
              {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} formatter={nomSerie} />}
              {series.map((s, i) => (
                <Bar
                  key={s} dataKey={s} name={nomSerie(s)}
                  fill={PALETTE[i % PALETTE.length]} radius={[4, 4, 0, 0]} maxBarSize={56}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>

        {spec.type === 'donut' && total > 0 && (
          <div className="copilot-chart__total" aria-hidden="true">
            <span className="copilot-chart__total-value">{total.toLocaleString('fr-FR')}</span>
            {spec.unit && <span className="copilot-chart__total-unit">{spec.unit}</span>}
          </div>
        )}
      </div>

      <div className="copilot-chart__foot">
        {spec.unit && <span className="copilot-chart__unit">en {spec.unit}</span>}
        {/* La source n'est pas décorative : sans elle, un graphique est une
            affirmation non sourcée, ce que le prompt système interdit. */}
        {spec.source && <span className="copilot-chart__source">[source : {spec.source}]</span>}
      </div>
    </figure>
  );
}
