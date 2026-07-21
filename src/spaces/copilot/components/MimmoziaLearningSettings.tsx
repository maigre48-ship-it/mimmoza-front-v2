import { useCallback, useEffect, useState } from 'react';
import {
  Sparkles, ShieldCheck, Trash2, MapPin, LayoutGrid, Home, Target, Loader2, Info,
} from 'lucide-react';

import { supabase } from '@/lib/supabaseClient';
import { getLearningEnabled, setLearningEnabled, purgeMyAiMemory } from '@/lib/mimmozia/track';
import './MimmoziaLearningSettings.css';

/* =========================================================================
   « Ce que MimmozIA a appris de vous »
   Panneau Réglages : activer/désactiver l'apprentissage, voir le profil dérivé
   (transparence), tout effacer (RGPD). Se branche sur v_user_profile + track.ts.
   À monter dans ta page Réglages / Compte : <MimmoziaLearningSettings />
   ========================================================================= */

interface ProfileDim { value: string; count: number; }
interface UserProfileRow {
  event_count: number;
  first_seen: string | null;
  last_seen: string | null;
  favorite_cities: ProfileDim[];
  favorite_modules: ProfileDim[];
  favorite_property_types: ProfileDim[];
  favorite_strategies: ProfileDim[];
  favorite_departments: ProfileDim[];
  budget_median: number | null;
  surface_median: number | null;
  profile_signals: Record<string, number>;
  derived_profile: 'promoteur' | 'investisseur' | 'particulier' | null;
  derived_profile_confidence: number | null;
}

const PROFILE_LABELS: Record<string, string> = {
  promoteur: 'Promoteur',
  investisseur: 'Investisseur locatif',
  particulier: 'Particulier',
};

function Chips({ icon: Icon, title, items }: { icon: typeof MapPin; title: string; items: ProfileDim[] }) {
  if (!items?.length) return null;
  return (
    <div className="mls-group">
      <div className="mls-group__head"><Icon size={14} />{title}</div>
      <div className="mls-chips">
        {items.map((it) => (
          <span key={it.value} className="mls-chip">
            {it.value}<span className="mls-chip__count">{it.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function MimmoziaLearningSettings() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [profile, setProfile] = useState<UserProfileRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [en, prof] = await Promise.all([
        getLearningEnabled(),
        (async () => {
          // security_invoker → ne renvoie que MA ligne ; null si apprentissage
          // désactivé (la vue exclut les utilisateurs opt-out) ou aucun événement.
          const { data } = await supabase.from('v_user_profile').select('*').maybeSingle();
          return (data as UserProfileRow | null) ?? null;
        })(),
      ]);
      setEnabled(en);
      setProfile(prof);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onToggle = useCallback(async () => {
    const next = !enabled;
    setEnabled(next);
    setBusy(true);
    try {
      await setLearningEnabled(next);
      await load();
    } finally {
      setBusy(false);
    }
  }, [enabled, load]);

  const onPurge = useCallback(async () => {
    setBusy(true);
    try {
      await purgeMyAiMemory();
      setConfirmPurge(false);
      await load();
    } finally {
      setBusy(false);
    }
  }, [load]);

  const hasData = Boolean(profile && profile.event_count > 0);
  const confidencePct =
    profile?.derived_profile_confidence != null
      ? Math.round(profile.derived_profile_confidence * 100)
      : null;

  return (
    <section className="mls">
      <header className="mls__header">
        <div className="mls__title">
          <Sparkles size={18} />
          <h2>Ce que MimmozIA a appris de vous</h2>
        </div>
        <p className="mls__intro">
          MimmozIA observe votre usage pour anticiper vos besoins. Ces observations
          restent <strong>privées</strong> et ne servent qu'à personnaliser votre expérience.
        </p>
      </header>

      {/* Interrupteur d'apprentissage */}
      <div className="mls-row">
        <div className="mls-row__text">
          <div className="mls-row__label">Apprentissage des habitudes</div>
          <div className="mls-row__hint">
            {enabled
              ? 'Activé — MimmozIA affine votre profil au fil de vos analyses.'
              : 'Désactivé — MimmozIA n\u2019observe plus rien. Vos données passées restent masquées (réactivez pour les retrouver, ou effacez-les ci-dessous).'}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          className={`mls-switch${enabled ? ' is-on' : ''}`}
          onClick={onToggle}
          disabled={busy || loading}
          title={enabled ? 'Désactiver' : 'Activer'}
        >
          <span className="mls-switch__knob" />
        </button>
      </div>

      {/* Contenu appris */}
      {loading ? (
        <div className="mls-state"><Loader2 size={16} className="mls-spin" /> Chargement…</div>
      ) : !enabled ? (
        <div className="mls-state mls-state--muted">
          <Info size={16} />
          Apprentissage désactivé. Rien n'est observé actuellement.
        </div>
      ) : !hasData ? (
        <div className="mls-state mls-state--muted">
          <Info size={16} />
          Pas encore assez d'observations. Continuez à utiliser MimmozIA — votre profil
          apparaîtra ici dès qu'elle en saura assez pour être utile.
        </div>
      ) : (
        <div className="mls-body">
          {/* Profil probabiliste */}
          <div className="mls-profile">
            <span className="mls-profile__label">Profil pressenti</span>
            {profile!.derived_profile ? (
              <span className="mls-profile__value">
                {PROFILE_LABELS[profile!.derived_profile]}
                {confidencePct != null && (
                  <span className="mls-profile__conf">confiance {confidencePct}%</span>
                )}
              </span>
            ) : (
              <span className="mls-profile__value mls-profile__value--pending">
                en cours de détermination
              </span>
            )}
          </div>

          <Chips icon={MapPin}    title="Villes suivies"       items={profile!.favorite_cities} />
          <Chips icon={LayoutGrid} title="Modules favoris"     items={profile!.favorite_modules} />
          <Chips icon={Home}      title="Types de biens"       items={profile!.favorite_property_types} />
          <Chips icon={Target}    title="Stratégies"           items={profile!.favorite_strategies} />
          <Chips icon={MapPin}    title="Départements"         items={profile!.favorite_departments} />

          {(profile!.budget_median != null || profile!.surface_median != null) && (
            <div className="mls-metrics">
              {profile!.budget_median != null && (
                <span className="mls-metric">
                  Budget médian&nbsp;
                  <strong>{Math.round(profile!.budget_median).toLocaleString('fr-FR')} €</strong>
                </span>
              )}
              {profile!.surface_median != null && (
                <span className="mls-metric">
                  Surface médiane&nbsp;
                  <strong>{Math.round(profile!.surface_median)} m²</strong>
                </span>
              )}
            </div>
          )}

          <div className="mls-count">{profile!.event_count} observations enregistrées</div>
        </div>
      )}

      {/* Effacement */}
      <footer className="mls__footer">
        {!confirmPurge ? (
          <button
            type="button"
            className="mls-purge"
            onClick={() => setConfirmPurge(true)}
            disabled={busy || loading}
          >
            <Trash2 size={15} />Effacer ce que MimmozIA a appris
          </button>
        ) : (
          <div className="mls-confirm">
            <span><ShieldCheck size={15} />Effacer définitivement toutes vos observations&nbsp;?</span>
            <div className="mls-confirm__actions">
              <button type="button" className="mls-btn mls-btn--ghost" onClick={() => setConfirmPurge(false)} disabled={busy}>
                Annuler
              </button>
              <button type="button" className="mls-btn mls-btn--danger" onClick={onPurge} disabled={busy}>
                {busy ? <Loader2 size={14} className="mls-spin" /> : <Trash2 size={14} />}Tout effacer
              </button>
            </div>
          </div>
        )}
      </footer>
    </section>
  );
}