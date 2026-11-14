// src/spaces/copilot/studio3d/CarteExtensionMaison.tsx
// =============================================================================
// LOT X3 (14/11/2026) — Carte « Extension de maison » (fil du chat et Dossier 3D).
// Affiche ce que le serveur a calculé (aucune valeur saisie ici) : maison existante ESTIMÉE avec le statut de chaque
// valeur, extension demandée et verdict du moteur (refus expliqués), surface créée ESTIMÉE, régime INDICATIF avec ses
// sources. Les questions restent les puces cliquables sous la réponse de Mimmo. Logique : extensionMaison.ts.
// =============================================================================
import { Home } from 'lucide-react';
import { libelleEtape, ligneExtension, ligneSurfaceCreee, type ExistantTravail, type LigneStatut, type VueCarteExtension } from './extensionMaison';
import './CarteExtensionMaison.css';

function Statut({ l }: { l: LigneStatut }) {
  if (!l.statut) return null;
  return <span className={`mz-ext__statut is-${l.statut}`} title={l.source || undefined}>{l.statutLibelle}</span>;
}

export function LignesStatut({ lignes }: { lignes: readonly LigneStatut[] }) {
  if (!lignes.length) return null;
  return <table className="mz-ext__table">
    <tbody>{lignes.map(l => <tr key={l.libelle}><th scope="row">{l.libelle}</th><td>{l.valeur}</td><td><Statut l={l} /></td></tr>)}</tbody>
  </table>;
}

export function CarteExtensionMaison({ vue, dossier = false }: { vue: VueCarteExtension; dossier?: boolean }) {
  const ext = vue.extension;
  const surface = ext ? ligneSurfaceCreee(ext) : null;
  return <section className={`mz-ext${dossier ? ' is-dossier' : ''}`} aria-label="Extension de maison">
    <header className="mz-ext__tete">
      <Home size={16} aria-hidden="true" />
      <strong>{libelleEtape(vue.etape)}</strong>
      <span className="mz-ext__ref">{vue.idu}{vue.commune ? ` · ${vue.commune}` : ''}</span>
    </header>
    {vue.maison && <div className="mz-ext__bloc">
      <p className="mz-ext__titre">{vue.maison.conservee === true ? 'Maison existante conservée' : vue.maison.conservee === false ? 'Maison existante démolie (projet neuf)' : 'Maison existante (base des bâtiments de l’IGN)'}</p>
      <LignesStatut lignes={vue.maison.lignes} />
      <p className="mz-ext__note">Les valeurs « estimée » et « SUPPOSÉE » ne sont pas des mesures ; « confirmée » vient de vous.</p>
      {vue.maison.hypotheses.length > 0 && <details><summary>Hypothèses de l’estimation ({vue.maison.hypotheses.length})</summary>
        <ul>{vue.maison.hypotheses.map(h => <li key={h}>{h}</li>)}</ul></details>}
    </div>}
    {ext && <div className={`mz-ext__bloc is-${ext.verdict}`}>
      <p className="mz-ext__titre">Extension : {ligneExtension(ext)}</p>
      {ext.verdict === 'ok' && <p>Le moteur d’extension la place sans refus.</p>}
      {ext.verdict === 'refus' && <><p role="status"><strong>Refusée par le moteur d’extension :</strong></p><ul>{ext.refus.map(r => <li key={r}>{r}</li>)}</ul></>}
      {ext.suggestion && <p>{ext.suggestion}</p>}
      {surface && <p>{surface}</p>}
      {ext.alertes.length > 0 && <ul className="mz-ext__alertes">{ext.alertes.map(a => <li key={a}>{a}</li>)}</ul>}
    </div>}
    {vue.regime && <div className="mz-ext__bloc">
      <p className="mz-ext__titre">Autorisation (indicatif) : {vue.regime.libelle} — {vue.regime.architecte}{vue.regime.ferme ? '' : ' (à confirmer)'}</p>
      <ul>{vue.regime.lignes.map(l => <li key={l}>{l}</li>)}</ul>
      <p className="mz-ext__note">{vue.regime.mention}{' '}
        {vue.regime.sources.map((s, i) => <span key={s.url}>{i > 0 ? ' · ' : ''}<a href={s.url} target="_blank" rel="noopener noreferrer">{s.titre}</a></span>)}</p>
    </div>}
    {vue.regles.length > 0 && <details><summary>Règles d’implantation utilisées ({vue.regles.length})</summary><ul>{vue.regles.map(r => <li key={r}>{r}</li>)}</ul></details>}
    {vue.avertissements.length > 0 && <ul className="mz-ext__alertes">{vue.avertissements.map(a => <li key={a}>{a}</li>)}</ul>}
    {vue.projetEnregistre && <p className="mz-ext__note">Projet d’extension enregistré dans la conversation (maison conservée, corrections comprises).</p>}
    {vue.sources.length > 0 && <p className="mz-ext__note">Sources : {vue.sources.join(' ; ')}.</p>}
  </section>;
}

/** Bloc « maison existante conservée » de la carte de résultat d'un rendu (et du Dossier 3D). */
export function BlocExistantConserve({ existant }: { existant: ExistantTravail }) {
  return <div className="mz-ext__conserve" role="note">
    <p><strong>{existant.titre}</strong></p>
    <p>{existant.phrase}</p>
    {existant.extension && <p>Extension : {existant.extension}</p>}
    {existant.surfaceCreee && <p>{existant.surfaceCreee}</p>}
    {existant.refus.length > 0 && <><p><strong>Refusée par le moteur d’extension :</strong></p><ul>{existant.refus.map(r => <li key={r}>{r}</li>)}</ul></>}
    <LignesStatut lignes={existant.maison} />
  </div>;
}
