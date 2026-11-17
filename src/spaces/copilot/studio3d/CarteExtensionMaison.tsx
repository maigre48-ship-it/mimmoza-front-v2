// src/spaces/copilot/studio3d/CarteExtensionMaison.tsx
// =============================================================================
// LOT X3 (14/11/2026) — Carte « Extension de maison » (fil du chat et Dossier 3D).
// Affiche ce que le serveur a calculé (aucune valeur saisie ici) : maison existante ESTIMÉE avec le statut de chaque
// valeur, extension demandée et verdict du moteur (refus expliqués), surface créée ESTIMÉE, régime INDICATIF avec ses
// sources. Les questions restent les puces cliquables sous la réponse de Mimmo. Logique : extensionMaison.ts.
// =============================================================================
import { Home } from 'lucide-react';
import { libelleEtape, ligneExtension, ligneSurfaceCreee, type ExistantTravail, type LigneStatut, type VueCarteExtension, type VueSecteur } from './extensionMaison';
import { EVENEMENT_PREPARER_DOSSIER, etatPreparerDossier, type VueDossierCarte } from './dossierExtension';
import { etatLirePlanExistant, EVENEMENT_IMPORTER_PLAN_EXISTANT } from './planExistantStudio';
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

/** LOT X3b — pastille « Secteur protégé : oui / non trouvé / non vérifié », avec source et date, et le détail dépliable. */
export function BlocSecteur({ secteur }: { secteur: VueSecteur }) {
  return <div className={`mz-ext__bloc mz-ext__secteur is-${secteur.etat}`}>
    <p><span className={`mz-ext__pastille is-${secteur.etat}`} role="status">{secteur.pastille}</span>
      {secteur.date && <span className="mz-ext__note"> · consulté le {secteur.date}</span>}</p>
    {secteur.protections.length > 0 && <ul>{secteur.protections.map(p => <li key={p}>{p}</li>)}</ul>}
    <details><summary>Architecte des Bâtiments de France, autorisation et délai (indicatif)</summary>
      <ul>{secteur.lignes.filter(l => !secteur.protections.includes(l)).map(l => <li key={l}>{l}</li>)}</ul>
      {secteur.consultations.length > 0 && <p className="mz-ext__note">Sources consultées : {secteur.consultations.join(' ; ')}.</p>}
      <p className="mz-ext__note">{secteur.mention}{' '}
        {secteur.sources.map((s, i) => <span key={s.url}>{i > 0 ? ' · ' : ''}<a href={s.url} target="_blank" rel="noopener noreferrer">{s.titre}</a></span>)}</p>
    </details>
  </div>;
}

/**
 * LOT D9 — « Préparer mon dossier » : aperçu des pièces établi par le SERVEUR (aucun texte du modèle), puis ouverture du
 * Studio intégré sur l'espace Dossier. Régime « DP ou PC » : deux boutons, la personne choisit. Gratuit (dit ici).
 */
export function BlocPreparerDossier({ vue }: { vue: VueCarteExtension }) {
  const etat = etatPreparerDossier(vue);
  const d: VueDossierCarte | null = vue.dossier;
  if (!etat.visible || !d) return null;
  const ouvrir = (regime: 'DP' | 'PC') => window.dispatchEvent(new CustomEvent(EVENEMENT_PREPARER_DOSSIER, { detail: { regime, idu: vue.idu } }));
  const listes = (['DP', 'PC'] as const).filter((r) => d.pieces[r]?.length);
  return <div className="mz-ext__bloc mz-ext__dossier" data-testid="carte-dossier">
    <p className="mz-ext__titre">Dossier de {d.choix.length === 1 ? (d.choix[0] === 'DP' ? 'déclaration préalable' : 'permis de construire') : 'déclaration préalable ou de permis de construire'}</p>
    {etat.question && <p role="status">{etat.question}</p>}
    {listes.map((r) => <details key={r} open={listes.length === 1}>
      <summary>Pièces {r === 'DP' ? 'de la déclaration préalable (cerfa 16702)' : 'du permis de construire (cerfa 13406)'}</summary>
      <ul>{d.pieces[r]!.map((p) => <li key={p.code}><b>{p.code}</b> {p.intitule} — {p.origine}{p.condition ? ` (${p.condition})` : ''}</li>)}</ul>
    </details>)}
    <p className="mz-ext__actions">{etat.boutons.map((b) => <button key={b.regime} type="button" className="mz-ext__bouton" onClick={() => ouvrir(b.regime)}>{b.libelle}</button>)}</p>
    <p className="mz-ext__note">{d.cout} {d.mention}</p>
  </div>;
}

/**
 * LOT F5 — « Lire le plan de l'existant » : le plan de la maison (fourni sur une autre page, ou PDF de la conversation)
 * est lu par le Studio, calé sur l'emprise de la maison conservée. Gratuit (calcul local), dit ici.
 */
export function BlocLirePlanExistant({ vue }: { vue: VueCarteExtension }) {
  if (!etatLirePlanExistant(vue)) return null;
  return <div className="mz-ext__bloc" data-testid="carte-plan-existant">
    <p className="mz-ext__titre">Plan de la maison existante</p>
    <p>Vous avez les plans de la maison (DXF, PDF, PNG ou JPEG) ? Le Studio les lit, les cale sur l’emprise de la maison et vous pose les questions sur ce qui reste incertain ; vous pouvez aussi relever les façades sur la photo calée.</p>
    <p className="mz-ext__actions"><button type="button" className="mz-ext__bouton" onClick={() => window.dispatchEvent(new CustomEvent(EVENEMENT_IMPORTER_PLAN_EXISTANT, { detail: { idu: vue.idu } }))}>Lire le plan de l’existant</button></p>
    <p className="mz-ext__note">Gratuit : la lecture se fait dans le Studio, sur votre ordinateur ; aucun jeton n’est consommé.</p>
  </div>;
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
    {vue.secteur && <BlocSecteur secteur={vue.secteur} />}
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
    {!dossier && <BlocLirePlanExistant vue={vue} />}
    {!dossier && <BlocPreparerDossier vue={vue} />}
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
    {/* LOT X7 — image « à valider » : raisons lisibles, arbre à abattre / arbuste à supprimer avec le rappel PLU. */}
    {existant.aValider.length > 0 && <div className="mz-ext__a-valider" role="status">
      <p><strong>Image à valider :</strong></p>
      <ul>{existant.aValider.map(r => <li key={r.code} data-code={r.code}>{r.texte}</li>)}</ul>
    </div>}
    {existant.vegetation && <div className="mz-ext__vegetation" role="note">
      <p><strong>Attention :</strong></p>
      <ul>{existant.vegetation.lignes.map(l => <li key={l}>{l}</li>)}</ul>
      <p className="mz-ext__note">{existant.vegetation.rappelPlu}</p>
    </div>}
    <LignesStatut lignes={existant.maison} />
    <LignesStatut lignes={existant.rendu} />
  </div>;
}
