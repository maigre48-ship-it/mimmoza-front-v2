import { useState } from "react";
import { X } from "lucide-react";

interface AddDossierModalProps {
  open: boolean;
  onClose: () => void;
  onAdd: (data: { title: string; address: string; sponsor: string; montant: number }) => void;
}

export function AddDossierModal({ open, onClose, onAdd }: AddDossierModalProps) {
  const [title, setTitle] = useState("");
  const [address, setAddress] = useState("");
  const [sponsor, setSponsor] = useState("");
  const [montant, setMontant] = useState("");

  if (!open) return null;

  const handleSubmit = () => {
    if (!title.trim()) return;
    onAdd({ title: title.trim(), address: address.trim(), sponsor: sponsor.trim(), montant: parseFloat(montant) || 0 });
    setTitle(""); setAddress(""); setSponsor(""); setMontant("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Nouveau dossier</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Nom du projet *</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" placeholder="Résidence Les Pins" autoFocus />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Adresse</label>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" placeholder="12 rue de la Paix, 75002 Paris" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Promoteur / Sponsor</label>
            <input type="text" value={sponsor} onChange={(e) => setSponsor(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" placeholder="Nexity" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Montant (€)</label>
            <input type="number" value={montant} onChange={(e) => setMontant(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" placeholder="5000000" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Annuler</button>
          <button onClick={handleSubmit} disabled={!title.trim()} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Créer le dossier</button>
        </div>
      </div>
    </div>
  );
}
