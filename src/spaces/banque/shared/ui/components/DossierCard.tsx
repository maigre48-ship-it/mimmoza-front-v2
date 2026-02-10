import { X, Copy, ArrowRight } from "lucide-react";
import type { BanqueProject } from "../../types/banque.types";
import { BANQUE_STATUT_LABELS, BANQUE_STATUT_COLORS } from "../../types/banque.types";
import { scoreColor } from "../../services/banqueSmartscore";

interface DossierCardProps {
  project: BanqueProject;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}

export function DossierCard({ project, onOpen, onDelete, onDuplicate }: DossierCardProps) {
  const score = project.smartscore?.global ?? null;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow relative group cursor-pointer" onClick={() => onOpen(project.id)}>
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={(e) => { e.stopPropagation(); onDuplicate(project.id); }} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600" title="Dupliquer"><Copy size={14} /></button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(project.id); }} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500" title="Supprimer"><X size={14} /></button>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: BANQUE_STATUT_COLORS[project.statut] }}>{BANQUE_STATUT_LABELS[project.statut]}</span>
        {score !== null && (<span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ color: scoreColor(score), backgroundColor: `${scoreColor(score)}15` }}>{score}/100</span>)}
      </div>
      <h3 className="font-semibold text-gray-900 text-sm leading-tight mb-1 pr-12">{project.title}</h3>
      <p className="text-xs text-gray-500 mb-2 truncate">{project.address}</p>
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>{project.sponsor}</span>
        <span className="font-medium text-gray-600">{(project.montant / 1e6).toFixed(1)}M€</span>
      </div>
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
        <span className="text-[10px] text-gray-400">MAJ {new Date(project.updatedAt).toLocaleDateString("fr-FR")}</span>
        <ArrowRight size={12} className="text-gray-300 group-hover:text-indigo-500 transition-colors" />
      </div>
    </div>
  );
}
