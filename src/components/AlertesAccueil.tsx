// ============================================================================
// AlertesAccueil — bandeau d'alertes non lues sur la page d'accueil MimmozIA.
//
// Agrège deux flux de veille de l'utilisateur courant (RLS : chacun ne voit
// que ses lignes) :
//   • opportunity_watch_events  → nouveaux biens / baisses de prix   (seen)
//   • ao_watch_events           → nouveaux appels d'offres BOAMP     (is_read)
//
// Principe : discret par défaut. Aucune alerte, chargement ou erreur ⇒ le
// composant ne rend rien du tout (pas de squelette, pas de message vide).
// ============================================================================

import { useEffect, useState } from 'react';
import { AlertCircle, ArrowUpRight, Bell, Gavel, TrendingDown } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

const MAX_ITEMS = 3;

type AlerteKind = 'opportunite' | 'baisse' | 'appel_offres';

export interface AlerteAccueilItem {
  id: string;
  kind: AlerteKind;
  title: string;
  detail?: string;
  url?: string;
  createdAt?: string;
}

interface OpportunityWatchEventRow {
  id: string;
  event_type: string | null;
  title: string | null;
  url: string | null;
  price: number | null;
  price_delta_pct: number | null;
  score: number | null;
  created_at: string | null;
}

interface AoWatchEventRow {
  id: string;
  objet: string | null;
  acheteur: string | null;
  url: string | null;
  jours_restants: number | null;
  created_at: string | null;
}

const EUR = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

function mapOpportunity(row: OpportunityWatchEventRow): AlerteAccueilItem {
  const isDrop =
    row.event_type === 'price_drop' ||
    (typeof row.price_delta_pct === 'number' && row.price_delta_pct < 0);

  const bits: string[] = [];
  if (typeof row.price === 'number') bits.push(EUR.format(row.price));
  if (isDrop && typeof row.price_delta_pct === 'number') {
    bits.push(`${row.price_delta_pct.toFixed(1).replace('.', ',')} %`);
  }
  if (typeof row.score === 'number') bits.push(`score ${row.score}`);

  return {
    id: `opp-${row.id}`,
    kind: isDrop ? 'baisse' : 'opportunite',
    title: row.title?.trim() || (isDrop ? 'Baisse de prix détectée' : 'Nouvelle opportunité'),
    detail: bits.join(' · ') || undefined,
    url: row.url ?? undefined,
    createdAt: row.created_at ?? undefined,
  };
}

function mapAo(row: AoWatchEventRow): AlerteAccueilItem {
  const bits: string[] = [];
  if (row.acheteur?.trim()) bits.push(row.acheteur.trim());
  if (typeof row.jours_restants === 'number') {
    bits.push(
      row.jours_restants <= 0
        ? 'clôture imminente'
        : `${row.jours_restants} j restants`,
    );
  }

  return {
    id: `ao-${row.id}`,
    kind: 'appel_offres',
    title: row.objet?.trim() || 'Nouvel appel d’offres',
    detail: bits.join(' · ') || undefined,
    url: row.url ?? undefined,
    createdAt: row.created_at ?? undefined,
  };
}

const ICONS: Record<AlerteKind, typeof Bell> = {
  opportunite: Bell,
  baisse: TrendingDown,
  appel_offres: Gavel,
};

const KIND_LABEL: Record<AlerteKind, string> = {
  opportunite: 'Opportunité',
  baisse: 'Baisse de prix',
  appel_offres: 'Appel d’offres',
};

/** Charge les alertes non lues de l'utilisateur courant. */
export function useAlertesAccueil(limit = MAX_ITEMS) {
  const [items, setItems] = useState<AlerteAccueilItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    void (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth?.user) {
          if (alive) { setItems([]); setLoading(false); }
          return;
        }

        const [opps, aos] = await Promise.all([
          supabase
            .from('opportunity_watch_events')
            .select('id, event_type, title, url, price, price_delta_pct, score, created_at')
            .eq('seen', false)
            .order('created_at', { ascending: false })
            .limit(limit),
          supabase
            .from('ao_watch_events')
            .select('id, objet, acheteur, url, jours_restants, created_at')
            .eq('is_read', false)
            .order('created_at', { ascending: false })
            .limit(limit),
        ]);

        if (!alive) return;

        const merged: AlerteAccueilItem[] = [
          ...((opps.data ?? []) as OpportunityWatchEventRow[]).map(mapOpportunity),
          ...((aos.data ?? []) as AoWatchEventRow[]).map(mapAo),
        ]
          .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
          .slice(0, limit);

        setItems(merged);
        setLoading(false);
      } catch {
        if (alive) { setItems([]); setLoading(false); }
      }
    })();

    return () => { alive = false; };
  }, [limit]);

  return { items, loading };
}

export default function AlertesAccueil({ limit = MAX_ITEMS }: { limit?: number }) {
  const { items, loading } = useAlertesAccueil(limit);

  // Discrétion : rien à dire ⇒ rien à afficher.
  if (loading || items.length === 0) return null;

  return (
    <div className="mzia-alertes" role="status" aria-live="polite">
      <div className="mzia-alertes__head">
        <AlertCircle size={14} aria-hidden />
        <span>
          {items.length === 1
            ? '1 alerte non lue'
            : `${items.length} alertes non lues`}
        </span>
      </div>

      <ul className="mzia-alertes__list">
        {items.map((item) => {
          const Icon = ICONS[item.kind];
          const content = (
            <>
              <Icon size={14} aria-hidden className="mzia-alertes__icon" />
              <span className="mzia-alertes__text">
                <strong>{item.title}</strong>
                {item.detail ? <em> — {item.detail}</em> : null}
              </span>
              {item.url ? <ArrowUpRight size={13} aria-hidden /> : null}
            </>
          );

          return (
            <li key={item.id} className="mzia-alertes__item" title={KIND_LABEL[item.kind]}>
              {item.url ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  {content}
                </a>
              ) : (
                <span>{content}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
