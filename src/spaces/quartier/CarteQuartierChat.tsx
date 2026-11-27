// src/spaces/quartier/CarteQuartierChat.tsx
// =============================================================================
// VIS-70 — carte « Le quartier » sous la réponse de Mimmo (sortie de l'outil quartier_atouts, relue par
// lireCarteQuartier) : synthèse « À 5 min à pied : … », plan de situation en vignette, une ligne par catégorie
// (le lieu le plus proche et son temps), et UN bouton « Ouvrir la page Quartier » (les atouts sont confiés à la
// session : la page s'ouvre sur les mêmes chiffres). Aucun jeton débité.
// =============================================================================
import { ecrireAtoutsSession } from '../../lib/quartier/chargerQuartier.ts';
import { lignesSynthese, type CarteQuartierChat as Carte } from '../../lib/quartier/texteAtouts.ts';
import { PlanSchematique } from './PlanSchematique';
import { PastilleCategorie } from './PictoCategorie';
import './CarteQuartierChat.css';

export function CarteQuartierChat({ carte }: { carte: Carte }) {
  const a = carte.atouts;
  const lignes = lignesSynthese(a);
  return (
    <section className="mz-qrc" aria-label="Le quartier du projet">
      <div className="mz-qrc__haut">
        <div className="mz-qrc__plan"><PlanSchematique atouts={a} categorie={null} compact /></div>
        <div className="mz-qrc__intro">
          <span className="mz-qrc__surtitre">Le quartier</span>
          <p className="mz-qrc__phrase">{a.synthese.phrase}</p>
          <p className="mz-qrc__transport">{a.synthese.phraseTransports}</p>
        </div>
      </div>
      <ul className="mz-qrc__lignes">
        {lignes.map((l) => (
          <li key={l.categorie} className="mz-qrc__ligne">
            <PastilleCategorie id={l.categorie} taille={22} />
            <span className="mz-qrc__libelle">{l.libelle}</span>
            <span className="mz-qrc__valeur">{l.valeur}</span>
          </li>
        ))}
      </ul>
      <div className="mz-qrc__bas">
        <a className="mz-qrc__bouton" href={carte.lienPage} target="_blank" rel="noopener noreferrer" onClick={() => ecrireAtoutsSession(a)}>Ouvrir la page Quartier</a>
        <span className="mz-qrc__note">Temps estimés, non contractuels · {a.sources.filter((s) => s.ok).map((s) => s.licence).filter((v, i, t) => t.indexOf(v) === i).join(', ')}</span>
      </div>
    </section>
  );
}
