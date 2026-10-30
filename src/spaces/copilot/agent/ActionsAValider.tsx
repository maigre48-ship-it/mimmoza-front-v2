// src/spaces/copilot/agent/ActionsAValider.tsx
// Onglet « À valider » : courriels et courriers préparés par l'agent.
// RIEN ne part sans un clic de l'utilisateur. « Valider » appelle d'abord
// agent_action_valider (avec le texte éventuellement corrigé), puis l'Edge
// Function agent-action-envoyer-v1 :
//   · courriel : Mimmoza n'a pas (encore) de boîte d'envoi par utilisateur →
//     réponse `boite_non_connectee` : c'est le parcours NORMAL, on propose
//     « Ouvrir dans ma messagerie » (mailto) et « Copier le texte » ;
//   · courrier : un PDF prêt à imprimer est préparé (lien valable 1 h ;
//     un nouveau lien peut être redemandé à tout moment). Aucun envoi postal.
import { useCallback, useEffect, useState } from 'react';
import { Copy, FileText, Mail } from 'lucide-react';
import { envoyerAction, listerActions, refuserAction, validerAction } from './agentApi';
import {
  dateCourte, LIBELLE_QUALITE, lienMailto, texteACopier, type IssueEnvoi,
} from './agentLogique';
import type { ActionExterne } from './agent.types';
import { useAgentUi } from './agentUi.store';

export function ActionsAValider() {
  const version = useAgentUi((s) => s.version);
  const [actions, setActions] = useState<ActionExterne[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try { setActions(await listerActions()); setErreur(null); }
    catch (e) { setErreur(e instanceof Error ? e.message : 'Lecture impossible.'); setActions((a) => a ?? []); }
  }, []);
  useEffect(() => { void charger(); }, [charger, version]);

  if (actions === null) return <p className="mzag-muet">Chargement…</p>;
  if (erreur && actions.length === 0) return <p className="mzag-alerte">{erreur}</p>;

  const aRelire = actions.filter((a) => a.statut === 'brouillon' || a.statut === 'echec' || (a.statut === 'valide' && a.canal !== 'email'));
  const prets = actions.filter((a) => a.statut === 'valide' && a.canal === 'email');
  const historique = actions.filter((a) => a.statut === 'envoye' || a.statut === 'refuse');

  return (
    <div className="mzag-pile">
      <p className="mzag-info" style={{ margin: 0 }}>
        MimmozIA prépare des courriels et des courriers, mais n’envoie jamais rien seul : vous relisez, corrigez si besoin, puis vous décidez.
      </p>
      {aRelire.length === 0 && prets.length === 0 && (
        <div className="mzag-vide"><strong>Rien à valider</strong>Les brouillons préparés pendant vos missions apparaîtront ici.</div>
      )}
      {aRelire.map((a) => <CarteAction key={a.id} action={a} onChange={() => void charger()} />)}

      {prets.length > 0 && (
        <>
          <h3 className="mzag-sur" style={{ margin: '18px 0 0' }}>Courriels validés, à envoyer depuis votre messagerie</h3>
          {prets.map((a) => <CarteAction key={a.id} action={a} onChange={() => void charger()} />)}
        </>
      )}

      {historique.length > 0 && (
        <details>
          <summary className="mzag-petit" style={{ cursor: 'pointer' }}>Historique ({historique.length})</summary>
          <div className="mzag-pile" style={{ marginTop: 10 }}>
            {historique.map((a) => <LigneHistorique key={a.id} action={a} />)}
          </div>
        </details>
      )}
    </div>
  );
}

function LigneHistorique({ action }: { action: ActionExterne }) {
  const [lien, setLien] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const pdf = action.canal === 'courrier' && action.statut === 'envoye';

  const obtenirLien = async () => {
    setOccupe(true); setMessage(null);
    // L'envoi est idempotent : pour un courrier déjà prêt, la fonction renvoie
    // simplement un nouveau lien vers le même PDF.
    const r = await envoyerAction(action.id);
    if (r.genre === 'envoye' && r.lienPdf) setLien(r.lienPdf);
    else setMessage(r.genre === 'echec' ? r.message : 'Le PDF n’est pas disponible.');
    setOccupe(false);
  };

  return (
    <div className="mzag-memo">
      <div className="mzag-memo__haut">
        <span className={`mzag-pastille mzag-pastille--${action.statut === 'envoye' ? 'succes' : 'neutre'}`}>
          {action.statut === 'refuse' ? 'Écarté' : action.canal === 'courrier' ? 'PDF prêt' : 'Envoyé'}
        </span>
        <strong style={{ fontSize: 13 }}>{action.objet || 'Sans objet'}</strong>
      </div>
      <span className="mzag-petit">{action.destinataire.nom} · {dateCourte(action.envoye_le ?? action.cree_le)}</span>
      {pdf && (
        <div className="mzag-actions" style={{ marginTop: 8 }}>
          {lien
            ? <a className="mzag-btn mzag-btn--petit" href={lien} target="_blank" rel="noopener noreferrer"><FileText size={13} aria-hidden /> Ouvrir le PDF</a>
            : <button type="button" className="mzag-btn mzag-btn--petit" disabled={occupe} onClick={() => void obtenirLien()}>{occupe ? 'Préparation…' : 'Retrouver le PDF'}</button>}
          {message && <span className="mzag-petit" style={{ color: '#b91c1c' }}>{message}</span>}
        </div>
      )}
    </div>
  );
}

function CarteAction({ action, onChange }: { action: ActionExterne; onChange: () => void }) {
  const modifiable = action.statut === 'brouillon' || action.statut === 'echec';
  const courriel = action.canal === 'email';
  const [objet, setObjet] = useState(action.objet);
  const [corps, setCorps] = useState(action.corps);
  const [occupe, setOccupe] = useState<'valider' | 'refuser' | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [issue, setIssue] = useState<IssueEnvoi | null>(null);
  const [copie, setCopie] = useState(false);
  const texte = { ...action, objet, corps };
  const valide = action.statut === 'valide' || issue !== null && issue.genre !== 'echec';
  const pretMessagerie = courriel && (action.statut === 'valide' || issue?.genre === 'boite_non_connectee');
  const mailto = (issue?.genre === 'boite_non_connectee' && issue.mailto) || lienMailto(texte);

  const valider = async () => {
    const question = courriel
      ? `Valider ce courriel pour ${action.destinataire.nom} ? Vous pourrez ensuite l’ouvrir dans votre messagerie pour l’envoyer.`
      : `Valider ce courrier pour ${action.destinataire.nom} ? Un PDF prêt à imprimer sera préparé (aucun envoi postal).`;
    if (!window.confirm(question)) return;
    setOccupe('valider'); setErreur(null); setIssue(null);
    try {
      if (action.statut !== 'valide') await validerAction(action.id, objet.trim(), corps);
      const r = await envoyerAction(action.id);
      setIssue(r);
      useAgentUi.getState().signalerChangement();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'La validation a échoué.');
    } finally { setOccupe(null); }
  };

  const refuser = async () => {
    const q = action.statut === 'valide' ? 'Retirer ce courriel de la liste ?' : 'Écarter ce brouillon ? Il ne sera pas envoyé.';
    if (!window.confirm(q)) return;
    setOccupe('refuser'); setErreur(null);
    try { await refuserAction(action.id); useAgentUi.getState().signalerChangement(); onChange(); }
    catch (e) { setErreur(e instanceof Error ? e.message : 'L’opération a échoué.'); }
    finally { setOccupe(null); }
  };

  const copier = async () => {
    try { await navigator.clipboard.writeText(texteACopier(texte)); setCopie(true); window.setTimeout(() => setCopie(false), 2500); }
    catch { setErreur('La copie a été bloquée par le navigateur. Sélectionnez le texte à la main.'); }
  };

  const libelleStatut = action.statut === 'echec' ? 'À reprendre' : valide ? (courriel ? 'Prêt à envoyer' : 'Validé') : 'À relire';
  const tonStatut = action.statut === 'echec' ? 'erreur' : valide ? 'succes' : 'actif';

  return (
    <article className="mzag-carte">
      <div className="mzag-item__haut">
        <span className="mzag-sur">{courriel ? <Mail size={14} aria-hidden /> : <FileText size={14} aria-hidden />} {courriel ? 'Courriel' : 'Courrier'}</span>
        <span className={`mzag-pastille mzag-pastille--${tonStatut}`}>{libelleStatut}</span>
      </div>
      <p className="mzag-action__dest">
        À : <strong>{action.destinataire.nom}</strong> ({LIBELLE_QUALITE[action.destinataire.qualite] ?? action.destinataire.qualite})
        {action.destinataire.email ? ` · ${action.destinataire.email}` : ''}
        {action.destinataire.adresse ? ` · ${action.destinataire.adresse}` : ''}
      </p>
      {courriel && !action.destinataire.email && <p className="mzag-info" style={{ margin: '0 0 10px' }}>Aucune adresse e-mail connue pour ce destinataire : vous la saisirez dans votre messagerie.</p>}
      {action.erreur && action.statut === 'echec' && <p className="mzag-alerte" style={{ margin: '0 0 10px' }}>Le dernier essai n’a pas abouti. Vous pouvez corriger le texte et valider à nouveau.</p>}

      {modifiable && !valide ? (
        <>
          <div className="mzag-champ">
            <label htmlFor={`objet-${action.id}`}>Objet</label>
            <input id={`objet-${action.id}`} className="mzag-input" value={objet} maxLength={300} onChange={(e) => setObjet(e.target.value)} />
          </div>
          <div className="mzag-champ">
            <label htmlFor={`corps-${action.id}`}>Texte</label>
            <textarea id={`corps-${action.id}`} className="mzag-textarea" rows={9} value={corps} onChange={(e) => setCorps(e.target.value)} />
          </div>
        </>
      ) : (
        <>
          <p style={{ fontWeight: 600, margin: '0 0 6px' }}>{objet}</p>
          <div className="mzag-lecture">{corps}</div>
        </>
      )}

      {erreur && <p className="mzag-alerte" role="alert" style={{ margin: '10px 0 0' }}>{erreur}</p>}
      {issue?.genre === 'echec' && <p className="mzag-alerte" role="alert" style={{ margin: '10px 0 0' }}>{issue.message}</p>}
      {issue?.genre === 'envoye' && (
        <p className="mzag-ok" style={{ margin: '10px 0 0' }}>
          {courriel ? 'Courriel envoyé.' : 'Courrier prêt à imprimer. '}
          {issue.lienPdf && <a href={issue.lienPdf} target="_blank" rel="noopener noreferrer">Ouvrir le PDF</a>}
          {issue.lienPdf && <span className="mzag-petit"> (lien valable une heure ; il reste disponible dans l’historique)</span>}
        </p>
      )}
      {pretMessagerie && issue?.genre !== 'envoye' && (
        <p className="mzag-ok" style={{ margin: '10px 0 0' }}>
          Courriel validé. Ouvrez-le dans votre messagerie pour l’envoyer, ou copiez le texte.
        </p>
      )}

      <div className="mzag-actions" style={{ marginTop: 12 }}>
        {!valide && (
          <button type="button" className="mzag-btn mzag-btn--plein mzag-btn--petit" disabled={occupe !== null || !objet.trim() || !corps.trim()} onClick={() => void valider()}>
            {occupe === 'valider' ? 'Validation…' : courriel ? 'Valider' : 'Valider et préparer le PDF'}
          </button>
        )}
        {!courriel && action.statut === 'valide' && !issue && (
          <button type="button" className="mzag-btn mzag-btn--plein mzag-btn--petit" disabled={occupe !== null} onClick={() => void valider()}>
            {occupe === 'valider' ? 'Préparation…' : 'Préparer le PDF'}
          </button>
        )}
        {courriel && (
          <a className={`mzag-btn mzag-btn--petit${pretMessagerie ? ' mzag-btn--plein' : ''}`} href={mailto}
            title={pretMessagerie ? undefined : 'Ouvre le texte actuel dans votre messagerie, sans le valider ici'}>
            <Mail size={13} aria-hidden /> Ouvrir dans ma messagerie
          </a>
        )}
        <button type="button" className="mzag-btn mzag-btn--petit" onClick={() => void copier()}><Copy size={13} aria-hidden /> {copie ? 'Copié' : 'Copier le texte'}</button>
        {issue?.genre !== 'envoye' && (
          <button type="button" className="mzag-btn mzag-btn--discret mzag-btn--petit" disabled={occupe !== null} onClick={() => void refuser()}>
            {occupe === 'refuser' ? '…' : action.statut === 'valide' || pretMessagerie ? 'Retirer de la liste' : 'Refuser'}
          </button>
        )}
      </div>
      <p className="mzag-petit" style={{ margin: '8px 0 0' }}>Préparé {dateCourte(action.cree_le)}</p>
    </article>
  );
}
