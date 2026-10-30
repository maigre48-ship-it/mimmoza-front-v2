// src/spaces/copilot/agent/conception/BilanVivant.tsx
// Panneau latéral de l'Atelier 3D (mode conception) : bilan promoteur recalculé
// à chaque modification du modèle (CA, coûts, charge foncière, écart avec la
// dernière version enregistrée) et conformité PLU règle par règle.
import { useMemo, useState } from 'react';
import { ChevronRight, FileSpreadsheet, Save } from 'lucide-react';
import type { ChargeMetriques, PrecisionPlan } from '@/spaces/promoteur/shared/echangeStudio/conception';
import { fEur, fEurM2, fM2, fNb, type ModeleRapport, type Nombre, type TerrainModele } from '../rapport/rapportModele';
import { libelleEtatBilan } from '../rapport/bilanCalcul';
import { nomFichierRapport } from '../rapport/rapportModele';
import {
  bilanVersion, conformiteAffichee, ecartsBilan, entreesConception, modeleRapportVersion, resumeConformite, texteDelta,
  texteTypologies, VOIES_PLAN, type Conception, type VersionConception,
} from './conceptionLogique';

interface Props {
  conception: Conception;
  voie: PrecisionPlan;
  rapport: ModeleRapport | null;
  terrain: TerrainModele | null;
  surface: Nombre;
  courant: ChargeMetriques | null;
  versions: VersionConception[];
  ouvert: boolean;
  onBasculer: () => void;
  onEnregistrer: () => void;
  enregistrement: boolean;
  message: string | null;
  /** Aucun conception.pret ni métriques 10 s après l'ouverture : Studio trop ancien. */
  studioAncien?: boolean;
}

export function BilanVivant({ conception, voie, rapport, terrain, surface, courant, versions, ouvert, onBasculer, onEnregistrer, enregistrement, message, studioAncien = false }: Props) {
  const [export_, setExport] = useState(false);
  const calcul = useMemo(() => {
    if (!courant) return null;
    const e = entreesConception(rapport, terrain, courant.metriques, conception.regles, surface);
    return { e, ...bilanVersion(e) };
  }, [courant, rapport, terrain, conception.regles, surface]);
  const derniere = versions[0] ?? null;
  const ecarts = useMemo(() => {
    if (!calcul || !derniere?.bilan) return null;
    const b = derniere.bilan;
    return ecartsBilan(
      { resultat: { ca: b.ca_ht, coutsHorsFoncier: b.couts_hors_foncier_ht, chargeFonciere: b.charge_fonciere_admissible_ht }, sdp: derniere.metriques?.sdp_m2 ?? null },
      { resultat: { ca: calcul.bilan.ca_ht, coutsHorsFoncier: calcul.bilan.couts_hors_foncier_ht, chargeFonciere: calcul.bilan.charge_fonciere_admissible_ht }, sdp: courant?.metriques.sdp_m2 ?? null },
    );
  }, [calcul, derniere, courant]);
  const conformite = useMemo(() => conformiteAffichee(conception.regles, courant?.conformite ?? [], courant?.metriques ?? null, surface), [conception.regles, courant, surface]);
  const resume = resumeConformite(conformite);

  const exporterExcel = async () => {
    if (!calcul || export_) return;
    setExport(true);
    try {
      const m = modeleRapportVersion(rapport, conception, calcul.e, null);
      const { construireClasseurBilan } = await import('../rapport/bilanExcel');
      const buffer = await construireClasseurBilan(m).xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([new Uint8Array(buffer as ArrayBuffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a'); a.href = url; a.download = nomFichierRapport({ ...m, commune: conception.commune ?? m.commune }, 'xlsx', true);
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally { setExport(false); }
  };

  if (!ouvert) {
    return <button type="button" className="mzcp-languette" onClick={onBasculer} aria-label="Afficher le bilan">Bilan</button>;
  }
  const r = calcul?.resultat;
  return (
    <aside className="mzag mzcp-bilan" aria-label="Bilan en direct">
      <div className="mzcp-bilan__tete">
        <div>
          <span className="mzag-sur">Bilan en direct · {conception.idu.slice(-6)}</span>
          <div className="mzag-petit">{VOIES_PLAN[voie].precision}</div>
        </div>
        <button type="button" className="mzag-iconbtn" onClick={onBasculer} aria-label="Réduire le bilan"><ChevronRight size={16} /></button>
      </div>

      {!courant ? (
        studioAncien
          ? <p className="mzag-alerte">L’Atelier doit être mis à jour pour la conception : il ne renvoie pas encore les surfaces du modèle. Le bilan ne peut pas suivre vos modifications.</p>
          : <p className="mzag-muet">En attente du modèle : le bilan s’affichera dès que l’Atelier aura posé le bâtiment.</p>
      ) : (
        <>
          <div className="mzcp-metriques">
            <span><strong>{fM2(courant.metriques.sdp_m2)}</strong> SDP</span>
            <span><strong>{fM2(courant.metriques.shab_m2)}</strong> SHAB</span>
            <span>{courant.metriques.nb_logements == null ? <>logements <strong>à préciser</strong></> : <><strong>{fNb(courant.metriques.nb_logements)}</strong> logements</>}</span>
            <span><strong>{courant.metriques.niveaux}</strong> niveaux · {courant.metriques.hauteur_m.toFixed(1).replace('.', ',')} m</span>
          </div>
          <p className="mzag-petit" style={{ margin: '4px 0 8px' }}>{texteTypologies(courant.metriques.typologies)}</p>

          {r && (
            <p className={`mzcp-etat mzcp-etat--${r.etat}`}>{libelleEtatBilan(r)}</p>
          )}
          <table className="mzcp-table">
            <tbody>
              <Ligne libelle="Chiffre d’affaires" valeur={fEur(calcul!.bilan.ca_ht)} delta={ecarts?.ca?.delta} />
              <Ligne libelle="Coûts hors foncier" valeur={fEur(calcul!.bilan.couts_hors_foncier_ht)} delta={ecarts?.couts?.delta} inverse />
              <Ligne libelle="Charge foncière admissible" valeur={fEur(calcul!.bilan.charge_fonciere_admissible_ht)} delta={ecarts?.chargeFonciere?.delta} fort />
              <Ligne libelle="… par m² de terrain" valeur={fEurM2(calcul!.bilan.charge_fonciere_eur_m2_terrain)} />
              <Ligne libelle="… par m² de SDP" valeur={fEurM2(calcul!.bilan.charge_fonciere_eur_m2_sdp)} />
            </tbody>
          </table>
          {derniere && <p className="mzag-petit">Écarts comparés à la version {derniere.n} enregistrée.</p>}
          <p className="mzag-petit">Suivent le modèle : surfaces (SDP, SHAB) et nombre de logements{conception.regles.some((x) => x.cle === 'mixite_sociale_pct' && x.statut !== 'manquant') ? ', part sociale (règle de mixité)' : ''}. Taxes d’urbanisme, VRD et démolition restent ceux de la prospection : ils ne suivent pas le modèle.</p>
          {calcul!.bilan.manques.length > 0 && (
            <details className="mzcp-manques">
              <summary>{calcul!.bilan.manques.length} hypothèse(s) à renseigner</summary>
              <ul className="mzag-puces">{calcul!.bilan.manques.map((x) => <li key={x}>{x}</li>)}</ul>
              <p className="mzag-petit">Complétez-les dans le bilan Excel (cellules jaunes).</p>
            </details>
          )}
          {!rapport && <p className="mzag-petit">Hypothèses de la prospection introuvables : seules les surfaces du modèle sont connues.</p>}
        </>
      )}

      <h4 className="mzcp-h4">Règles du PLU <span className="mzag-petit">{resume.ok} respectée(s) · {resume.depassements} dépassement(s) · {resume.inconnues} non contrôlée(s)</span></h4>
      <ul className="mzcp-regles">
        {conformite.map((l) => (
          <li key={l.cle} className={`mzcp-regle mzcp-regle--${l.ok === true ? 'ok' : l.ok === false ? 'ko' : 'inconnu'}`}>
            <span className="mzcp-regle__pastille" aria-hidden>{l.ok === true ? '✓' : l.ok === false ? '!' : '?'}</span>
            <span>
              <strong>{l.libelle}</strong>
              {l.limite != null && <> · limite {typeof l.limite === 'number' ? String(Math.round(l.limite * 10) / 10).replace('.', ',') : l.limite} {typeof l.limite === 'number' ? l.unite : ''}</>}
              {l.valeur_modele != null && <> · modèle {String(Math.round(l.valeur_modele * 10) / 10).replace('.', ',')} {l.unite}</>}
              {l.ecart && <div className="mzag-petit">{l.ecart}</div>}
              {l.regle && l.regle.statut !== 'manquant' && <div className="mzag-petit">Source : {l.regle.source}{l.regle.article ? `, ${l.regle.article}` : ''}{l.regle.statut === 'estime' ? ' (estimée, à confirmer)' : ''}</div>}
            </span>
          </li>
        ))}
      </ul>

      {courant?.resume && <p className="mzag-petit">Dernière modification : {courant.resume}</p>}
      {message && <p className="mzag-info" role="status">{message}</p>}
      <div className="mzag-actions" style={{ marginTop: 10 }}>
        <button type="button" className="mzag-btn mzag-btn--plein mzag-btn--petit" disabled={!courant || enregistrement} onClick={onEnregistrer}>
          <Save size={13} aria-hidden /> {enregistrement ? 'Enregistrement…' : 'Enregistrer cette version'}
        </button>
        <button type="button" className="mzag-btn mzag-btn--petit" disabled={!calcul || export_} onClick={() => void exporterExcel()}>
          <FileSpreadsheet size={13} aria-hidden /> {export_ ? 'Préparation…' : 'Bilan Excel'}
        </button>
      </div>
      <p className="mzag-petit" style={{ marginTop: 8 }}>Bilan indicatif, à faire valider par un professionnel.</p>
    </aside>
  );
}

function Ligne({ libelle, valeur, delta, fort, inverse }: { libelle: string; valeur: string; delta?: number; fort?: boolean; inverse?: boolean }) {
  const ton = delta == null || Math.abs(delta) < 0.5 ? '' : (delta > 0) !== Boolean(inverse) ? ' mzcp-delta--plus' : ' mzcp-delta--moins';
  return (
    <tr className={fort ? 'mzcp-fort' : undefined}>
      <th scope="row">{libelle}</th>
      <td>{valeur}{delta != null && <span className={`mzcp-delta${ton}`}>{texteDelta(delta)}</span>}</td>
    </tr>
  );
}
