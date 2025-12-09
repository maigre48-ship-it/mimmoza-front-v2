import React, { useState } from 'react';
import { Sidebar } from '../../components/Sidebar';

const MENU_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'new', label: 'Nouveau dossier de financement' },
  { id: 'dossiers', label: 'Dossiers de crédit' },
  { id: 'scoring', label: 'Paramétrage scoring (à venir)' },
];

export function BanqueLayout() {
  const [page, setPage] = useState('dashboard');

  return (
    <div className='flex flex-1 overflow-hidden'>
      <Sidebar
        title='Banque'
        items={MENU_ITEMS}
        current={page}
        onChange={setPage}
      />
      <div className='flex-1 bg-slate-100 p-6 overflow-auto'>
        {page === 'dashboard' && <BanqueDashboard />}
        {page === 'new' && <Placeholder title='Nouveau dossier de financement' />}
        {page === 'dossiers' && <Placeholder title='Dossiers de crédit' />}
        {page === 'scoring' && <Placeholder title='Paramétrage scoring' />}
      </div>
    </div>
  );
}

function BanqueDashboard() {
  return (
    <div className='space-y-4'>
      <header>
        <h1 className='text-xl font-semibold text-slate-900'>
          Dashboard Banque
        </h1>
        <p className='text-sm text-slate-600'>
          Analysez les biens et projets immobiliers en vue d&apos;une décision
          de crédit.
        </p>
      </header>

      <div className='grid gap-4 md:grid-cols-3'>
        <KpiCard label='Dossiers en cours' value='0' />
        <KpiCard label='Taux d&apos;acceptation' value='–' />
        <KpiCard label='Exposition totale' value='– €' />
      </div>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-2xl bg-white p-4 shadow-sm border border-slate-200'>
      <div className='text-xs text-slate-500'>{label}</div>
      <div className='mt-1 text-xl font-semibold text-slate-900'>{value}</div>
    </div>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className='rounded-2xl bg-white p-6 shadow-sm border border-slate-200'>
      <h1 className='text-lg font-semibold text-slate-900 mb-2'>{title}</h1>
      <p className='text-sm text-slate-600'>
        La structure est prête, nous brancherons ici les modules de scoring,
        risques, SmartScore et rapports pour les comités de crédit.
      </p>
    </div>
  );
}
