import React from "react";

interface MainLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
  sidebar?: React.ReactNode;
  headerContent?: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
  children,
  title,
  subtitle,
  actions,
  breadcrumbs,
  sidebar,
  headerContent,
}) => {
  const handleLogoClick = () => {
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f7f4]">
      {/* HEADER GLOBAL MIMMOZA */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between">
          <button
            type="button"
            onClick={handleLogoClick}
            className="flex items-center gap-2 group"
          >
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#facc15] to-[#c9a227] flex items-center justify-center text-xs font-bold text-slate-900 shadow-sm">
              M
            </div>
            <div className="flex flex-col items-start leading-tight">
              <span className="text-sm font-semibold tracking-tight text-slate-900 group-hover:text-slate-950">
                Mimmoza
              </span>
              <span className="text-[11px] text-slate-400">
                Studio de faisabilité foncière
              </span>
            </div>
          </button>

          <div className="hidden sm:flex items-center gap-3 text-[11px] text-slate-400">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1" />
              Beta privée
            </span>
            <span>PLU Engine · Promoteur v1</span>
          </div>
        </div>
      </header>

      {/* PAGE HEADER (titre / breadcrumbs / actions) */}
      {(title || breadcrumbs || actions || headerContent) && (
        <div className="bg-[#f8f7f4] border-b border-slate-200/70">
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-5">
            {breadcrumbs && breadcrumbs.length > 0 && (
              <nav className="flex items-center gap-1 text-xs mb-3 text-slate-500 flex-wrap">
                {breadcrumbs.map((crumb, index) => (
                  <React.Fragment key={index}>
                    {index > 0 && (
                      <span className="px-1 text-slate-400">›</span>
                    )}
                    {crumb.href ? (
                      <a
                        href={crumb.href}
                        className="hover:text-slate-800 transition underline-offset-2 hover:underline"
                      >
                        {crumb.label}
                      </a>
                    ) : (
                      <span className="font-medium text-slate-800">
                        {crumb.label}
                      </span>
                    )}
                  </React.Fragment>
                ))}
              </nav>
            )}

            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                {title && (
                  <h1 className="text-2xl md:text-3xl font-semibold text-slate-900 mb-1">
                    {title}
                  </h1>
                )}
                {subtitle && (
                  <p className="text-sm md:text-base text-slate-600">
                    {subtitle}
                  </p>
                )}
              </div>
              {actions && (
                <div className="flex items-center gap-3">
                  {actions}
                </div>
              )}
            </div>

            {headerContent && <div className="mt-4">{headerContent}</div>}
          </div>
        </div>
      )}

      {/* ZONE CONTENU AVEC SIDEBAR OPTIONNELLE */}
      <div className="flex">
        {sidebar && (
          <aside className="w-64 bg-white border-r border-slate-200 min-h-[calc(100vh-56px)] hidden lg:block">
            {sidebar}
          </aside>
        )}

        <main className="flex-1 p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
};
