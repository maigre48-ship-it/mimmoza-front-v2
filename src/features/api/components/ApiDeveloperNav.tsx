import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, CreditCard, Key, PlayCircle } from 'lucide-react';

interface NavItem {
  label: string;
  path: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard',   path: '/api/developer', icon: LayoutDashboard },
  { label: 'Abonnement',  path: '/api/billing',   icon: CreditCard },
  { label: 'Clés API',    path: '/api/keys',      icon: Key },
  { label: 'Playground',  path: '/api/playground',icon: PlayCircle },
];

interface ApiDeveloperNavProps {
  compact?: boolean;
}

export default function ApiDeveloperNav({ compact = false }: ApiDeveloperNavProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const isActive = (path: string) =>
    pathname === path || (path !== '/api' && pathname.startsWith(path));

  if (compact) {
    return (
      <nav className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1">
        {NAV_ITEMS.map(({ label, path, icon: Icon }) => {
          const active = isActive(path);
          return (
            <button
              key={path}
              type="button"
              onClick={() => navigate(path)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium transition-all ${
                active
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="space-y-0.5">
      <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        Espace développeur
      </p>
      {NAV_ITEMS.map(({ label, path, icon: Icon }) => {
        const active = isActive(path);
        return (
          <button
            key={path}
            type="button"
            onClick={() => navigate(path)}
            className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
              active
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </button>
        );
      })}
    </nav>
  );
}