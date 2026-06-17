import { useParams } from "react-router-dom";

export default function Comite() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-2">Comité Crédit</h1>
      <p className="text-slate-500">Fiche comité — Dossier <strong>{id}</strong></p>
    </div>
  );
}