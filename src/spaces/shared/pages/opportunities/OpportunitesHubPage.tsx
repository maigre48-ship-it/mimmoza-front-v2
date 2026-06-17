// =============================================================
// Mimmoza · Opportunités (hub unifié)
// Un seul onglet qui réunit le scan ponctuel ET le suivi de zone dans le temps.
// Bascule interne : "Scanner une zone" / "Mes veilles" (badge de non-lus).
// Header calé exactement sur les dimensions du hero de QuickAnalysis.
// =============================================================

import React from 'react';
import { Bell, ScanSearch } from 'lucide-react';
import OpportunitiesPage from './OpportunitiesPage';
import OpportunityWatchesPage from '@/spaces/shared/pages/veille/OpportunityWatchesPage';
import { countUnseen } from '@/services/opportunity/opportunityWatch.service';

type HubView = 'scan' | 'watches';

export default function OpportunitesHubPage() {
  const [view, setView] = React.useState<HubView>('scan');
  const [unseen, setUnseen] = React.useState(0);

  const refreshUnseen = React.useCallback(async () => {
    try {
      setUnseen(await countUnseen());
    } catch {
      /* silencieux */
    }
  }, []);

  React.useEffect(() => {
    void refreshUnseen();
    const id = setInterval(() => void refreshUnseen(), 60000);
    return () => clearInterval(id);
  }, [refreshUnseen]);

  // Quand on ouvre "Mes veilles", on rafraichit le compteur.
  React.useEffect(() => {
    if (view === 'watches') void refreshUnseen();
  }, [view, refreshUnseen]);

  const tabBase =
    'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition';
  const tabActive = 'bg-indigo-600 text-white shadow-sm';
  const tabIdle = 'text-slate-600 hover:bg-slate-100';

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      {/* HERO — dimensions identiques a QuickAnalysis (enfant direct, pleine largeur) */}
      <div
        style={{
          background: 'linear-gradient(135deg, #3366cc 0%, #4685e0 50%, #66a3ee 100%)',
          borderRadius: 32,
          padding: '40px 44px',
          marginTop: 24,
          marginBottom: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24,
          boxShadow: '0 20px 60px rgba(15,23,42,0.08)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 12,
              color: 'rgba(255,255,255,0.9)',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              marginBottom: 10,
              fontWeight: 600,
            }}
          >
            MIMMOZA · OPPORTUNITÉS
          </div>

          <div
            style={{
              fontSize: 36,
              fontWeight: 600,
              color: '#fff',
              marginBottom: 10,
              lineHeight: 1.1,
              letterSpacing: '-0.025em',
            }}
          >
            Opportunités
          </div>

          <div
            style={{
              fontSize: 14,
              color: 'rgba(255,255,255,0.78)',
              maxWidth: 540,
              lineHeight: 1.55,
            }}
          >
            Scan ponctuel · Suivi dans le temps · Alertes — moteur Mimmoza
          </div>
        </div>
      </div>

      {/* Contenu — meme conteneur que QuickAnalysis (maxWidth 1440, padding 0 28px) */}
      <div style={{ maxWidth: 1440, margin: '0 auto', padding: '0 28px 24px' }}>
        {/* Bascule */}
        <div className="mb-6 inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
          <button
            type="button"
            onClick={() => setView('scan')}
            className={`${tabBase} ${view === 'scan' ? tabActive : tabIdle}`}
          >
            <ScanSearch className="h-4 w-4" /> Scanner une zone
          </button>
          <button
            type="button"
            onClick={() => setView('watches')}
            className={`${tabBase} ${view === 'watches' ? tabActive : tabIdle}`}
          >
            <Bell className="h-4 w-4" /> Mes veilles
            {unseen > 0 && (
              <span className="ml-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                {unseen > 99 ? '99+' : unseen}
              </span>
            )}
          </button>
        </div>

        {view === 'scan' ? (
          <OpportunitiesPage embedded />
        ) : (
          <OpportunityWatchesPage embedded onGoScan={() => setView('scan')} />
        )}
      </div>
    </div>
  );
}