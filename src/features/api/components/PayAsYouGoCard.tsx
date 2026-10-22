// src/features/api/components/PayAsYouGoCard.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Ancien « Pay as you go » (facturation après coup) : SUPPRIMÉ du modèle.
// Ce composant présente désormais la RECHARGE PRÉPAYÉE réservée aux abonnés
// (nom de fichier conservé : pas de suppression de fichier dans le dépôt).
// ─────────────────────────────────────────────────────────────────────────────
import { Mail, Zap } from 'lucide-react';
import { API_FORMULES_PAYANTES, PHRASE_RECHARGE_API } from '../../../lib/api/catalogueApi';
import { formatEurHT, mailtoDemandeAcces } from '../../../lib/billing/grille';

export default function RechargePrepayeeCard() {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-100">
          <Zap className="h-5 w-5 text-cyan-600" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900">Recharge prépayée</h3>
          <p className="text-sm text-slate-500">Des crédits en plus, payés à l'avance</p>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-slate-600">{PHRASE_RECHARGE_API}</p>

      <ul className="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-slate-50">
        {API_FORMULES_PAYANTES.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <span className="text-slate-600">Abonnés {f.nom}</span>
            <strong className="text-slate-900">
              {formatEurHT(f.rechargeParMilleHT ?? 0, true)} <span className="font-normal text-slate-500">/ 1 000 crédits</span>
            </strong>
          </li>
        ))}
      </ul>

      <a
        href={mailtoDemandeAcces('API — recharge de crédits')}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-300 bg-cyan-50 py-2.5 text-sm font-semibold text-cyan-700 transition-all hover:bg-cyan-100"
      >
        <Mail className="h-4 w-4" />
        Demander une recharge
      </a>
    </div>
  );
}
