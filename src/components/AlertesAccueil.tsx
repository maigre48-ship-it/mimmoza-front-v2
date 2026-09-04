// ============================================================================
// AlertesAccueil — bandeau d'alertes non lues sur la page d'accueil MimmozIA.
//
// UNE SEULE SOURCE : l'edge function `alertes-accueil-v1`.
// ---------------------------------------------------------------------------
// Ce composant interrogeait auparavant les tables directement, et il ne lisait
// PAS les mêmes que le copilote :
//
//   accueil (avant) : opportunity_watch_events  ← table à 0 ligne, tous comptes
//   copilote        : watch_zones, user_watchlists, ao_watches
//
// D'où l'incohérence vécue en production : l'accueil annonçait une alerte que
// le chat ne voyait pas, et réciproquement. Deux écrans du même produit
// répondaient différemment à la même question, parce qu'ils ne regardaient pas
// le même endroit.
//
// `alertes-accueil-v1` réunit les deux gisements réellement alimentés —
// ao_watch_events (produits par ao-watch-run-v1) et market_opportunities
// croisées aux user_watchlists actives — en lisant les MÊMES tables que le
// copilote. Toute règle de filtrage (veille parente active, avis expirés,
// péremption des données de marché) vit désormais à UN seul endroit.
//
// Principe : discret par défaut. Aucune alerte, chargement ou erreur ⇒ le
// composant ne rend rien du tout (pas de squelette, pas de message vide).
// L'EXCEPTION est l'avertissement de fraîcheur : quand le moteur de marché
// est à l'arrêt, se taire ferait passer une panne pour « rien à signaler ».
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

/** Forme renvoyée par `alertes-accueil-v1` (voir l'en-tête de cette fonction). */
interface ReponseAlertes {
  status?: string;
  appels_offres?: Array<{
    id?: string; titre?: string | null; sous_titre?: string | null;
    url?: string | null; jours_restants?: number | null;
    urgent?: boolean; detecte_le?: string | null;
  }>;
  immobilier?: Array<{
    id?: string; titre?: string | null; sous_titre?: string | null;
    url?: string | null; score?: number | null; niveau?: string | null;
    calcule_le?: string | null;
  }>;
  fraicheur?: { avertissement?: string | null };
}

function mapAo(r: NonNullable<ReponseAlertes['appels_offres']>[number]): AlerteAccueilItem {
  const bits: string[] = [];
  if (r.sous_titre?.trim()) bits.push(r.sous_titre.trim());
  if (typeof r.jours_restants === 'number') {
    bits.push(r.jours_restants <= 0 ? 'clôture imminente' : `${r.jours_restants} j restants`);
  }
  return {
    id: `ao-${r.id ?? Math.random().toString(36).slice(2)}`,
    kind: 'appel_offres',
    title: r.titre?.trim() || 'Nouvel appel d’offres',
    detail: bits.join(' · ') || undefined,
    url: r.url ?? undefined,
    createdAt: r.detecte_le ?? undefined,
  };
}

function mapImmo(r: NonNullable<ReponseAlertes['immobilier']>[number]): AlerteAccueilItem {
  const bits: string[] = [];
  if (r.sous_titre?.trim()) bits.push(r.sous_titre.trim());
  if (typeof r.score === 'number') bits.push(`score ${Math.round(r.score)}`);

  // `niveau` traduit la qualité de l'opportunité côté serveur. On s'en sert
  // pour choisir l'icône, sans réinterpréter le score nous-mêmes : le calcul
  // appartient au moteur, pas au bandeau.
  const estBaisse = typeof r.niveau === 'string' && /baisse|drop|price/i.test(r.niveau);

  return {
    id: `immo-${r.id ?? Math.random().toString(36).slice(2)}`,
    kind: estBaisse ? 'baisse' : 'opportunite',
    title: r.titre?.trim() || 'Nouvelle opportunité',
    detail: bits.join(' · ') || undefined,
    url: r.url ?? undefined,
    createdAt: r.calcule_le ?? undefined,
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
  const [avertissement, setAvertissement] = useState<string | null>(null);
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

        // Un SEUL appel. Les règles de filtrage (veille parente active, avis
        // expirés, croisement watchlists × opportunités, péremption) vivent
        // dans la fonction, donc au même endroit que pour le copilote.
        const { data, error } = await supabase.functions.invoke<ReponseAlertes>(
          'alertes-accueil-v1',
          { body: { limite: limit } },
        );

        if (!alive) return;

        // Un échec ne doit pas se confondre avec « aucune alerte » : on le
        // trace. C'est précisément ce silence qui avait masqué une requête
        // rejetée pendant des semaines.
        if (error) {
          console.error('[AlertesAccueil] alertes-accueil-v1 :', error.message);
          setItems([]); setAvertissement(null); setLoading(false);
          return;
        }

        const merged: AlerteAccueilItem[] = [
          ...(data?.appels_offres ?? []).map(mapAo),
          ...(data?.immobilier ?? []).map(mapImmo),
        ]
          .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
          .slice(0, limit);

        setItems(merged);
        setAvertissement(data?.fraicheur?.avertissement ?? null);
        setLoading(false);
      } catch (e) {
        console.error('[AlertesAccueil]', e);
        if (alive) { setItems([]); setAvertissement(null); setLoading(false); }
      }
    })();

    return () => { alive = false; };
  }, [limit]);

  return { items, avertissement, loading };
}

export default function AlertesAccueil({ limit = MAX_ITEMS }: { limit?: number }) {
  const { items, avertissement, loading } = useAlertesAccueil(limit);

  // Discrétion : rien à dire ⇒ rien à afficher. MAIS un avertissement de
  // fraîcheur doit passer même sans alerte : « aucune opportunité » et « le
  // moteur d'opportunités est à l'arrêt » se ressemblent à l'écran, et se
  // taire ferait passer la seconde pour la première.
  if (loading || (items.length === 0 && !avertissement)) return null;

  return (
    <div className="mzia-alertes" role="status" aria-live="polite">
      {items.length > 0 && (
        <div className="mzia-alertes__head">
          <AlertCircle size={14} aria-hidden />
          <span>
            {items.length === 1
              ? '1 alerte non lue'
              : `${items.length} alertes non lues`}
          </span>
        </div>
      )}

      {avertissement && (
        <div className="mzia-alertes__head" style={{ opacity: 0.75 }}>
          <AlertCircle size={14} aria-hidden />
          <span>{avertissement}</span>
        </div>
      )}

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
