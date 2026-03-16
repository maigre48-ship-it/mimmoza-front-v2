import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Coins,
  FileText,
  ReceiptText,
  Building2,
  Settings,
  LogOut,
  ChevronRight,
} from 'lucide-react';

interface NavItem {
  label: string;
  icon: React.ElementType;
  to: string;
}

const navItems: NavItem[] = [
  { label: 'Dashboard',     icon: LayoutDashboard, to: '/admin' },
  { label: 'Utilisateurs',  icon: Users,           to: '/admin/utilisateurs' },
  { label: 'Abonnements',   icon: CreditCard,      to: '/admin/abonnements' },
  { label: 'Jetons',        icon: Coins,           to: '/admin/jetons' },
  { label: 'Devis',         icon: FileText,        to: '/admin/devis' },
  { label: 'Factures',      icon: ReceiptText,     to: '/admin/factures' },
  { label: 'Entreprises',   icon: Building2,       to: '/admin/entreprises' },
  { label: 'Paramètres',    icon: Settings,        to: '/admin/parametres' },
];

const AdminSidebar: React.FC = () => {
  const navigate = useNavigate();

  const handleLogout = () => {
    // adapter si besoin à ton auth Supabase
    navigate('/');
  };

  return (
    <aside className="flex h-full w-60 flex-col border-r border-gray-100 bg-white">
      {/* Logo / titre */}
      <div className="flex items-center gap-2 px-6 py-5 border-b border-gray-100">
        <span className="text-lg font-bold tracking-tight text-indigo-700">Mimmoza</span>
        <span className="ml-1 rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-indigo-500 tracking-widest">
          Admin
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
          Pilotage plateforme
        </p>
        <ul className="space-y-0.5">
          {navItems.map(({ label, icon: Icon, to }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/admin'}
                className={({ isActive }) =>
                  [
                    'group flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                  ].join(' ')
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="flex items-center gap-3">
                      <Icon
                        size={16}
                        className={isActive ? 'text-indigo-600' : 'text-gray-400 group-hover:text-gray-600'}
                      />
                      {label}
                    </span>
                    {isActive && (
                      <ChevronRight size={14} className="text-indigo-400" />
                    )}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Déconnexion */}
      <div className="border-t border-gray-100 px-3 py-4">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <LogOut size={16} />
          Déconnexion
        </button>
      </div>
    </aside>
  );
};

export default AdminSidebar;