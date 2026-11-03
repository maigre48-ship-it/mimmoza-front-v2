// src/spaces/copilot/studio3d/ConfirmationParcelleRapide.tsx
//
// « C'est bien cette parcelle ? » — confirmation en UN clic de la parcelle
// proposée par le Dossier 3D : référence cadastrale ET adresse la plus proche
// côte à côte, lien Géoportail pour vérifier, puis « Confirmer et voir en 3D ».
// « Autre parcelle » rouvre la recherche par adresse / carte (ConfirmerParcelle).
// Logique pure : confirmationRapide.ts.
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, MapPin } from 'lucide-react';
import type { ConfirmedTerrain } from './terrainCadastre';
import type { TerrainParcel } from './parcelFromGps';
import { adresseDepuisReponse, lienGeoportail, pointDansParcelle, terrainDepuisParcelle, urlAdresseInverse } from './confirmationRapide';

type EtatAdresse = { etat: 'recherche' } | { etat: 'trouvee'; label: string } | { etat: 'absente' };

export function ConfirmationParcelleRapide({ idu, reference, surfaceM2, zone, parcelle, onConfirmer, onAutre, onAnnuler }: {
  idu: string;
  /** « AN 0412 » */
  reference: string;
  surfaceM2: number | null;
  zone: string | null;
  parcelle: TerrainParcel;
  onConfirmer: (terrain: ConfirmedTerrain & { adresse: string | null }) => void;
  onAutre: () => void;
  onAnnuler: () => void;
}) {
  const point = useMemo(() => pointDansParcelle(parcelle), [parcelle]);
  const [adresse, setAdresse] = useState<EtatAdresse>({ etat: 'recherche' });

  useEffect(() => {
    // `actif` : une réponse arrivée après un changement de parcelle est ignorée.
    let actif = true;
    const controleur = new AbortController();
    setAdresse({ etat: 'recherche' });
    const minuterie = window.setTimeout(() => controleur.abort(), 8000);
    fetch(urlAdresseInverse(point), { signal: controleur.signal })
      .then(r => (r.ok ? r.json() : null))
      .then(json => { const label = adresseDepuisReponse(json); if (actif) setAdresse(label ? { etat: 'trouvee', label } : { etat: 'absente' }); })
      .catch(() => { if (actif) setAdresse({ etat: 'absente' }); })
      .finally(() => window.clearTimeout(minuterie));
    return () => { actif = false; window.clearTimeout(minuterie); controleur.abort(); };
  }, [point]);

  const label = adresse.etat === 'trouvee' ? adresse.label : null;
  const details = [surfaceM2 != null ? `${Math.round(surfaceM2).toLocaleString('fr-FR')} m²` : null, zone ? `zone ${zone}` : null].filter(Boolean).join(' · ');

  return (
    <div className="mzia-confrapide" role="group" aria-label="Confirmer la parcelle">
      <p className="mzia-confrapide__titre">C’est bien cette parcelle ?</p>
      <dl className="mzia-confrapide__grille">
        <div><dt>Parcelle</dt><dd><strong>{reference}</strong>{details ? <small>{details}</small> : null}<small className="mzia-confrapide__idu">{idu}</small></dd></div>
        <div><dt>Adresse la plus proche</dt><dd>
          {adresse.etat === 'recherche' && <span className="mzia-confrapide__attente"><Loader2 size={13} aria-hidden="true" /> Recherche…</span>}
          {adresse.etat === 'trouvee' && <span><MapPin size={13} aria-hidden="true" /> {adresse.label}</span>}
          {adresse.etat === 'absente' && <span className="mzia-confrapide__doux">Non trouvée — la référence cadastrale suffit.</span>}
        </dd></div>
      </dl>
      <a className="mzia-confrapide__carte" href={lienGeoportail(point)} target="_blank" rel="noopener noreferrer">
        Vérifier sur Géoportail <ExternalLink size={12} aria-hidden="true" />
      </a>
      <div className="mzia-confrapide__actions">
        <button type="button" className="mzia-confrapide__ok" onClick={() => onConfirmer(terrainDepuisParcelle(parcelle, idu, point, label))}>
          Confirmer et voir en 3D
        </button>
        <button type="button" className="mzia-confrapide__lien" onClick={onAutre}>Autre parcelle</button>
        <button type="button" className="mzia-confrapide__lien" onClick={onAnnuler}>Annuler</button>
      </div>
    </div>
  );
}
