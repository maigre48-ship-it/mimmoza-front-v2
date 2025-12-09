import React, { useState } from 'react';
import { Sidebar } from '../../components/Sidebar';

const MENU_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'new', label: 'Nouvelle opération' },
  { id: 'ops', label: 'Mes opérations' },
  { id: 'opportunites', label: 'Opportunités (à venir)' },
];

export function MarchandLayout() {
  const [page, setPage] = useState('dashboard');

  return (
    <div className='flex flex-1 overflow-hidden'>
      <Sidebar
        title='Marchand de biens'
        items={MENU_ITEMS}
        current={page}
        onChange={setPage}
      />
      <div className='flex-1 bg-slate-100 p-6 overflow-auto'>
        {page === 'dashboard' && <MarchandDashboard />}
        {page === 'new' && <Placeholder title='Nouvelle opération' />}
        {page === 'ops' && <Placeholder title='Mes opérations' />}
        {page === 'opportunites' && <Placeholder title='Opportunités' />}
      </div>
    </div>
  );
}

function MarchandDashboard() {
  return (
    <div className='space-y-4'>
      <header>
        <h1 className='text-xl font-semibold text-slate-900'>
          Dashboard Marchand de biens
        </h1>
        <p className='text-sm text-slate-600'>
          Analysez rapidement vos opérations d&apos;achat/revente, décotes et
          marges potentielles.
        </p>
      </header>

      <div className='rounded-2xl bg-white p-4 shadow-sm border border-slate-200'>
        <h2 className='text-sm font-semibold text-slate-900 mb-2'>
          Nouvelle opération rapide
        </h2>
        <div className='grid gap-2 md:grid-cols-3'>
          <div>
            <label className='text-xs font-medium text-slate-700'>
              Prix d&apos;achat
            </label>
            <input
              className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'
              placeholder='Ex : 300 000 €'
            />
          </div>
          <div>
            <label className='text-xs font-medium text-slate-700'>
              Budget travaux
            </label>
            <input
              className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'
              placeholder='Ex : 80 000 €'
            />
          </div>
          <div>
            <label className='text-xs font-medium text-slate-700'>
              Prix de revente visé
            </label>
            <input
              className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'
              placeholder='Ex : 450 000 €'
            />
          </div>
        </div>
        <button className='mt-3 inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800'>
          Estimer la marge
        </button>
      </div>
    </div>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className='rounded-2xl bg-white p-6 shadow-sm border border-slate-200'>
      <h1 className='text-lg font-semibold text-slate-900 mb-2'>{title}</h1>
      <p className='text-sm text-slate-600'>
        La structure est prête, nous brancherons ici les calculs de marge,
        risques, marché et scénarios de revente.
      </p>
    </div>
  );
}
