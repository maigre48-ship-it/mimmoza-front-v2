import { useEffect, useState } from "react";
import {
  getAdminSettings,
  initAdminStorage,
  saveAdminSettings,
  type AdminSettings,
} from "../services/adminStorage";

export default function AdminParametresPage() {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    initAdminStorage();
    setSettings(getAdminSettings());
  }, []);

  if (!settings) return null;

  const updateNumber =
    (key: keyof AdminSettings) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(e.target.value);
      setSettings((prev) =>
        prev ? { ...prev, [key]: Number.isFinite(value) ? value : 0 } : prev
      );
      setSaved(false);
    };

  const updateText =
    (key: keyof AdminSettings) =>
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setSettings((prev) => (prev ? { ...prev, [key]: e.target.value } : prev));
      setSaved(false);
    };

  const persist = () => {
    saveAdminSettings(settings);
    setSaved(true);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
          {"Paramètres"}
        </h1>
        <p className="mt-3 text-sm leading-7 text-slate-600">
          {"Réglages pricing, coût IA et notes internes d'administration."}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">
            Pricing investisseur
          </h2>
          <div className="mt-5 space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-600">
                10 analyses
              </label>
              <input
                type="number"
                step="0.01"
                value={settings.investorTokens10PriceHt}
                onChange={updateNumber("investorTokens10PriceHt")}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-600">
                20 analyses
              </label>
              <input
                type="number"
                step="0.01"
                value={settings.investorTokens20PriceHt}
                onChange={updateNumber("investorTokens20PriceHt")}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-600">
                Starter mensuel
              </label>
              <input
                type="number"
                step="0.01"
                value={settings.investorStarterPriceHt}
                onChange={updateNumber("investorStarterPriceHt")}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-600">
                Pro mensuel
              </label>
              <input
                type="number"
                step="0.01"
                value={settings.investorProPriceHt}
                onChange={updateNumber("investorProPriceHt")}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none"
              />
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">
            {"Pilotage IA & notes"}
          </h2>
          <div className="mt-5 space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-600">
                {"Coût IA estimé par analyse (€ HT)"}
              </label>
              <input
                type="number"
                step="0.001"
                value={settings.iaCostPerAnalysisHt}
                onChange={updateNumber("iaCostPerAnalysisHt")}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-600">
                Notes admin
              </label>
              <textarea
                rows={10}
                value={settings.adminNotes}
                onChange={updateText("adminNotes")}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={persist}
          className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white hover:bg-slate-800"
        >
          {"Enregistrer les paramètres"}
        </button>
        {saved && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {"Paramètres enregistrés."}
          </div>
        )}
      </div>
    </div>
  );
}