export function SpaceSelector({ onSelect }: { onSelect: (s: any) => void }) {
  return (
    <div className="h-screen flex flex-col items-center justify-center gap-6 bg-slate-100">
      <h1 className="text-3xl font-bold text-slate-900">Bienvenue sur Mimmoza</h1>
      <p className="text-slate-600">Choisissez un espace pour commencer</p>

      <div className="flex flex-col gap-3">
        <button
          onClick={() => onSelect("promoteur")}
          className="px-6 py-3 bg-yellow-400 text-slate-900 rounded-lg font-semibold hover:bg-yellow-500 shadow"
        >
          Espace Promoteur
        </button>
        <button
          onClick={() => onSelect("agence")}
          className="px-6 py-3 bg-slate-900 text-white rounded-lg hover:bg-slate-800 shadow"
        >
          Espace Agence
        </button>
      </div>
    </div>
  );
}
