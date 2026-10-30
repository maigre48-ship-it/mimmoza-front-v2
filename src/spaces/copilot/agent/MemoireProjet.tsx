// src/spaces/copilot/agent/MemoireProjet.tsx
// Onglet « Mémoire » : ce que MimmozIA retient de vos projets (faits,
// hypothèses, décisions…). Vous pouvez lire, corriger, épingler (toujours
// rappelé à MimmozIA) ou supprimer chaque élément.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { listerMemoire, modifierMemoire, nomsProjets, supprimerMemoire } from './agentApi';
import { dateCourte, LIBELLE_CONFIANCE, LIBELLE_MEMOIRE, MEMOIRE_CONTENU_MAX, trierMemoire } from './agentLogique';
import type { ElementMemoire } from './agent.types';
import { useAgentUi } from './agentUi.store';

const SANS_PROJET = '__general__';

export function MemoireProjet() {
  const version = useAgentUi((s) => s.version);
  const [items, setItems] = useState<ElementMemoire[] | null>(null);
  const [projets, setProjets] = useState<Record<string, string>>({});
  const [filtre, setFiltre] = useState<string>('tous');
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      const liste = await listerMemoire();
      setItems(liste); setErreur(null);
      setProjets(await nomsProjets(liste.map((m) => m.projet_id ?? '').filter(Boolean)));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Lecture impossible.');
      setItems((x) => x ?? []);
    }
  }, []);
  useEffect(() => { void charger(); }, [charger, version]);

  const choix = useMemo(() => {
    const ids = new Set((items ?? []).map((m) => m.projet_id ?? SANS_PROJET));
    return [...ids].map((id) => ({ id, nom: id === SANS_PROJET ? 'Mémoire générale' : projets[id] ?? 'Projet sans nom' }));
  }, [items, projets]);

  const visibles = useMemo(() => trierMemoire((items ?? []).filter((m) =>
    filtre === 'tous' || (m.projet_id ?? SANS_PROJET) === filtre)), [items, filtre]);

  const remplacer = (m: ElementMemoire) => setItems((xs) => (xs ?? []).map((x) => (x.id === m.id ? m : x)));

  if (items === null) return <p className="mzag-muet">Chargement…</p>;
  if (erreur && items.length === 0) return <p className="mzag-alerte">{erreur}</p>;
  if (items.length === 0) {
    return (
      <div className="mzag-vide">
        <strong>Mémoire vide</strong>
        Au fil des missions, MimmozIA note ici ce qu’il apprend de vos projets : hypothèses retenues, décisions, contacts. Vous gardez la main sur chaque élément.
      </div>
    );
  }
  return (
    <div className="mzag-pile">
      {choix.length > 1 && (
        <div className="mzag-filtre">
          <label className="mzag-petit" htmlFor="mzag-filtre-projet">Projet</label>
          <select id="mzag-filtre-projet" className="mzag-select" value={filtre} onChange={(e) => setFiltre(e.target.value)}>
            <option value="tous">Tous ({items.length})</option>
            {choix.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
        </div>
      )}
      {erreur && <p className="mzag-alerte" role="alert">{erreur}</p>}
      {visibles.map((m) => (
        <ElementMemoireCarte key={m.id} item={m} projet={m.projet_id ? projets[m.projet_id] : undefined}
          onMaj={remplacer} onSuppr={(id) => setItems((xs) => (xs ?? []).filter((x) => x.id !== id))} onErreur={setErreur} />
      ))}
    </div>
  );
}

function ElementMemoireCarte({ item, projet, onMaj, onSuppr, onErreur }: {
  item: ElementMemoire; projet?: string;
  onMaj: (m: ElementMemoire) => void; onSuppr: (id: string) => void; onErreur: (e: string | null) => void;
}) {
  const [edition, setEdition] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const executer = async (fn: () => Promise<void>) => {
    setOccupe(true); onErreur(null);
    try { await fn(); } catch (e) { onErreur(e instanceof Error ? e.message : 'La modification a échoué.'); }
    finally { setOccupe(false); }
  };

  const basculerEpingle = () => executer(async () => {
    await modifierMemoire(item.id, { epingle: !item.epingle });
    onMaj({ ...item, epingle: !item.epingle });
  });
  const enregistrer = () => executer(async () => {
    const contenu = (edition ?? '').trim();
    if (!contenu) return;
    await modifierMemoire(item.id, { contenu });
    onMaj({ ...item, contenu, source: 'utilisateur', maj_le: new Date().toISOString() });
    setEdition(null);
  });
  const supprimer = () => {
    if (!window.confirm('Supprimer cet élément de la mémoire ? MimmozIA ne s’en servira plus.')) return;
    void executer(async () => { await supprimerMemoire(item.id); onSuppr(item.id); });
  };

  return (
    <article className={`mzag-memo${item.epingle ? ' mzag-memo--epingle' : ''}`}>
      <div className="mzag-memo__haut">
        <span className="mzag-pastille mzag-pastille--actif" style={{ paddingLeft: 9 }}>{LIBELLE_MEMOIRE[item.genre] ?? item.genre}</span>
        {item.confiance && <span className={`mzag-pastille mzag-pastille--${item.confiance === 'a_verifier' ? 'attente' : item.confiance === 'confirme' ? 'succes' : 'neutre'}`}>{LIBELLE_CONFIANCE[item.confiance] ?? item.confiance}</span>}
        {projet && <span className="mzag-petit">{projet}</span>}
      </div>
      {edition !== null ? (
        <>
          <textarea className="mzag-textarea" rows={4} value={edition} maxLength={MEMOIRE_CONTENU_MAX} onChange={(e) => setEdition(e.target.value)} aria-label="Contenu de l’élément" autoFocus />
          <div className="mzag-actions" style={{ marginTop: 8 }}>
            <button type="button" className="mzag-btn mzag-btn--plein mzag-btn--petit" disabled={occupe || !edition.trim()} onClick={() => void enregistrer()}>Enregistrer</button>
            <button type="button" className="mzag-btn mzag-btn--discret mzag-btn--petit" onClick={() => setEdition(null)}>Annuler</button>
          </div>
        </>
      ) : <p className="mzag-memo__contenu">{item.contenu}</p>}
      <div className="mzag-memo__bas">
        <span className="mzag-petit">
          {item.source === 'utilisateur' ? 'Corrigé par vous' : item.source ? `Source : ${item.source}` : ''}
          {item.maj_le || item.cree_le ? ` · ${dateCourte(item.maj_le ?? item.cree_le)}` : ''}
        </span>
        {edition === null && (
          <span style={{ display: 'inline-flex', gap: 2 }}>
            <button type="button" className={`mzag-iconbtn${item.epingle ? ' mzag-iconbtn--actif' : ''}`} disabled={occupe} onClick={() => void basculerEpingle()}
              title={item.epingle ? 'Désépingler' : 'Épingler : MimmozIA s’en souviendra toujours'} aria-label={item.epingle ? 'Désépingler' : 'Épingler'} aria-pressed={item.epingle}>
              {item.epingle ? <PinOff size={15} /> : <Pin size={15} />}
            </button>
            <button type="button" className="mzag-iconbtn" disabled={occupe} onClick={() => setEdition(item.contenu)} title="Corriger" aria-label="Corriger"><Pencil size={15} /></button>
            <button type="button" className="mzag-iconbtn" disabled={occupe} onClick={supprimer} title="Supprimer" aria-label="Supprimer"><Trash2 size={15} /></button>
          </span>
        )}
      </div>
    </article>
  );
}
