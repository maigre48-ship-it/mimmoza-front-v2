import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Search, PanelLeftClose, PanelLeftOpen,
  MessageSquare, FolderPlus, Folder, ChevronRight,
  MoreHorizontal, Settings, Sparkles, Trash2, LogOut,
} from 'lucide-react';

import { supabase } from '@/lib/supabaseClient';
import { getLearningEnabled, setLearningEnabled, purgeMyAiMemory } from '@/lib/mimmozia/track';
import { MimmozIAOrb } from './components/MimmozIAOrb';
import './MimmozIASidebar.css';

/* =========================================================================
   MimmozIASidebar
   -------------------------------------------------------------------------
   Menu latéral gauche pour la page MimmozIA :
     • liste + recherche des conversations (câblée sur useCopilot, tolérante)
     • classement des discussions par PROJET (v1 côté client, swappable)
     • panneau Paramètres (apprentissage on/off + purge mémoire, tables P1)

   ⚠️ 2 COUTURES À CONFIRMER (voir INTEGRATION en bas de fichier) :
     1. Comment useCopilot expose la LISTE des conversations, et comment on
        OUVRE une conversation existante. On sonde les noms probables au
        runtime (pickConversations / pickSelect) ; si rien ne matche, un
        warning console te le dit et il suffira de m'indiquer les vrais noms.
     2. Le stockage des projets : ici en localStorage scopé par user
        (`u:{uid}:mzia.projects`). Dis-moi si tu préfères une table Supabase
        `conversation_projects`, je bascule la persistance sans toucher l'UI.
   ========================================================================= */

// On reste volontairement souple : useCopilot n'a pas de type stable côté page.
type AnyCopilot = Record<string, any>;

interface Conversation {
  id: string;
  title?: string;
  messages?: any[];
  created_at?: string;
  updated_at?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface Project {
  id: string;
  name: string;
  color: string;
}
interface ProjectStore {
  projects: Project[];
  assignments: Record<string, string>; // conversationId -> projectId
}

const PROJECT_COLORS = ['#6d5dfc', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];

/* ------------------------- Sondes tolérantes ---------------------------- */

function pickConversations(a: AnyCopilot): Conversation[] {
  const raw =
    a.conversations ?? a.conversationList ?? a.history ?? a.threads ?? a.chats;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c) => c && (c.id ?? c.conversation_id)).map((c) => ({
    ...c,
    id: String(c.id ?? c.conversation_id),
  }));
}

function pickSelect(a: AnyCopilot): ((id: string) => unknown) | undefined {
  return (
    a.selectConversation ??
    a.openConversation ??
    a.loadConversation ??
    a.switchConversation ??
    a.setActiveConversation ??
    a.setConversationId ??
    a.setActiveConversationId
  );
}

function pickActiveId(a: AnyCopilot): string | null {
  return (
    a.activeConversationId ??
    a.currentConversationId ??
    a.conversationId ??
    a.currentConversation?.id ??
    null
  );
}

function convTitle(c: Conversation): string {
  if (c.title && c.title.trim()) return c.title.trim();
  const first = Array.isArray(c.messages)
    ? c.messages.find((m: any) => (m?.role ?? m?.author) === 'user' || m?.isUser)
    : undefined;
  const txt: string | undefined =
    first?.content ?? first?.text ?? first?.body ?? undefined;
  if (typeof txt === 'string' && txt.trim()) {
    return txt.trim().slice(0, 48) + (txt.length > 48 ? '…' : '');
  }
  return 'Nouvelle conversation';
}

function convDate(c: Conversation): number {
  const d = c.updated_at ?? c.updatedAt ?? c.created_at ?? c.createdAt;
  const t = d ? Date.parse(d) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/* ----------------------- Persistance projets (v1) ----------------------- */

const emptyStore = (): ProjectStore => ({ projects: [], assignments: {} });
const projectsKey = (uid?: string | null) => `u:${uid ?? 'anon'}:mzia.projects`;

function loadProjects(uid?: string | null): ProjectStore {
  try {
    const raw = localStorage.getItem(projectsKey(uid));
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      assignments:
        parsed.assignments && typeof parsed.assignments === 'object'
          ? parsed.assignments
          : {},
    };
  } catch {
    return emptyStore();
  }
}
function saveProjects(uid: string | null | undefined, store: ProjectStore) {
  try {
    localStorage.setItem(projectsKey(uid), JSON.stringify(store));
  } catch {
    /* quota / mode privé : silencieux */
  }
}

/* ------------------------------ Props ----------------------------------- */

interface Props {
  copilot: AnyCopilot;
  /** Bouton "Nouvelle conversation" (réutilise le handler de la page). */
  onNewConversation: () => void;
  /** Appelé après sélection d'une conversation → la page bascule en mode chat. */
  onOpenConversation?: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Mobile : fermer le drawer après une action. */
  onCloseMobile?: () => void;
}

export function MimmozIASidebar({
  copilot,
  onNewConversation,
  onOpenConversation,
  collapsed,
  onToggleCollapsed,
  onCloseMobile,
}: Props) {
  const [uid, setUid] = useState<string | null>(null);
  const [email, setEmail] = useState<string | undefined>(undefined);

  const conversations = useMemo(() => pickConversations(copilot), [copilot]);
  const activeId = pickActiveId(copilot);
  const select = useMemo(() => pickSelect(copilot), [copilot]);

  const [store, setStore] = useState<ProjectStore>(emptyStore);
  const [query, setQuery] = useState('');
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});
  const [menuFor, setMenuFor] = useState<string | null>(null); // conv id du menu ouvert
  const [showSettings, setShowSettings] = useState(false);

  // --- Auth : uid (scope projets) + email (footer) ---
  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!alive) return;
      setUid(data.user?.id ?? null);
      setEmail(data.user?.email ?? undefined);
    })();
    return () => { alive = false; };
  }, []);

  // --- Charge la liste des conversations (filet, la page l'appelle déjà) ---
  useEffect(() => { void copilot.loadConversations?.(); }, [copilot]);

  // --- Charge les projets une fois l'uid connu ---
  useEffect(() => { setStore(loadProjects(uid)); }, [uid]);

  const mutate = useCallback((next: ProjectStore) => {
    setStore(next);
    saveProjects(uid, next);
  }, [uid]);

  /* ----------------------------- Actions ------------------------------- */

  const handleSelect = useCallback((id: string) => {
    if (select) select(id);
    else console.warn('[MimmozIASidebar] Aucune fonction d’ouverture de conversation détectée dans useCopilot — voir INTEGRATION.');
    onOpenConversation?.();
    onCloseMobile?.();
    setMenuFor(null);
  }, [select, onOpenConversation, onCloseMobile]);

  const handleNew = useCallback(() => {
    onNewConversation();
    onCloseMobile?.();
  }, [onNewConversation, onCloseMobile]);

  const createProject = useCallback(() => {
    const name = window.prompt('Nom du projet');
    if (!name || !name.trim()) return;
    const color = PROJECT_COLORS[store.projects.length % PROJECT_COLORS.length];
    const p: Project = { id: crypto.randomUUID(), name: name.trim(), color };
    mutate({ ...store, projects: [...store.projects, p] });
    setOpenProjects((o) => ({ ...o, [p.id]: true }));
  }, [store, mutate]);

  const deleteProject = useCallback((pid: string) => {
    if (!window.confirm('Supprimer ce projet ? Les conversations resteront, sans classement.')) return;
    const assignments = { ...store.assignments };
    Object.keys(assignments).forEach((cid) => { if (assignments[cid] === pid) delete assignments[cid]; });
    mutate({ projects: store.projects.filter((p) => p.id !== pid), assignments });
  }, [store, mutate]);

  const assign = useCallback((convId: string, pid: string | null) => {
    const assignments = { ...store.assignments };
    if (pid) assignments[convId] = pid; else delete assignments[convId];
    mutate({ ...store, assignments });
    setMenuFor(null);
  }, [store, mutate]);

  /* ---------------------------- Dérivations ---------------------------- */

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...conversations].sort((a, b) => convDate(b) - convDate(a));
    if (!q) return list;
    return list.filter((c) => convTitle(c).toLowerCase().includes(q));
  }, [conversations, query]);

  const byProject = useMemo(() => {
    const map: Record<string, Conversation[]> = {};
    const unassigned: Conversation[] = [];
    for (const c of filtered) {
      const pid = store.assignments[c.id];
      if (pid && store.projects.some((p) => p.id === pid)) {
        (map[pid] ??= []).push(c);
      } else {
        unassigned.push(c);
      }
    }
    return { map, unassigned };
  }, [filtered, store]);

  /* ------------------------------ Rendu -------------------------------- */

  return (
    <aside className={`mzia-side ${collapsed ? 'is-collapsed' : ''}`}>
      {/* En-tête */}
      <div className="mzia-side__head">
        {!collapsed && (
          <div className="mzia-side__brand">
            <MimmozIAOrb state="idle" size={26} />
            <span>MimmozIA</span>
          </div>
        )}
        <button
          type="button"
          className="mzia-side__collapse"
          onClick={onToggleCollapsed}
          title={collapsed ? 'Déployer le menu' : 'Réduire le menu'}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {/* Nouvelle conversation */}
      <button type="button" className="mzia-side__new" onClick={handleNew} title="Nouvelle conversation">
        <Plus size={18} />
        {!collapsed && <span>Nouvelle conversation</span>}
      </button>

      {collapsed ? (
        /* Rail réduit : icônes seules */
        <div className="mzia-side__rail">
          <button className="mzia-rail__btn" title="Conversations" onClick={onToggleCollapsed}><MessageSquare size={18} /></button>
          <button className="mzia-rail__btn" title="Projets" onClick={onToggleCollapsed}><Folder size={18} /></button>
          <button className="mzia-rail__btn" title="Paramètres" onClick={() => { onToggleCollapsed(); setShowSettings(true); }}><Settings size={18} /></button>
        </div>
      ) : (
        <>
          {/* Recherche */}
          <div className="mzia-side__search">
            <Search size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher une conversation…"
            />
          </div>

          <div className="mzia-side__scroll">
            {/* Projets */}
            <div className="mzia-side__sectionhead">
              <span>Projets</span>
              <button type="button" className="mzia-side__addproj" onClick={createProject} title="Nouveau projet">
                <FolderPlus size={15} />
              </button>
            </div>

            {store.projects.length === 0 && (
              <p className="mzia-side__hint">Créez un projet pour ranger vos discussions (ex. « 12 rue Victor Hugo », « Résidence Le Clos »).</p>
            )}

            {store.projects.map((p) => {
              const items = byProject.map[p.id] ?? [];
              const open = openProjects[p.id];
              return (
                <div key={p.id} className="mzia-proj">
                  <div className="mzia-proj__row">
                    <button
                      type="button"
                      className="mzia-proj__toggle"
                      onClick={() => setOpenProjects((o) => ({ ...o, [p.id]: !o[p.id] }))}
                    >
                      <ChevronRight size={14} className={`mzia-proj__chevron ${open ? 'is-open' : ''}`} />
                      <span className="mzia-proj__dot" style={{ background: p.color }} />
                      <span className="mzia-proj__name">{p.name}</span>
                      <span className="mzia-proj__count">{items.length}</span>
                    </button>
                    <button type="button" className="mzia-proj__del" title="Supprimer le projet" onClick={() => deleteProject(p.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {open && (
                    <div className="mzia-proj__items">
                      {items.length === 0 && <p className="mzia-side__hint mzia-side__hint--nested">Aucune conversation.</p>}
                      {items.map((c) => (
                        <ConversationRow
                          key={c.id}
                          conv={c}
                          active={c.id === activeId}
                          projects={store.projects}
                          currentProject={p.id}
                          menuOpen={menuFor === c.id}
                          onToggleMenu={() => setMenuFor((m) => (m === c.id ? null : c.id))}
                          onSelect={() => handleSelect(c.id)}
                          onAssign={(pid) => assign(c.id, pid)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Conversations sans projet */}
            <div className="mzia-side__sectionhead mzia-side__sectionhead--tight">
              <span>Récentes</span>
            </div>
            {byProject.unassigned.length === 0 && (
              <p className="mzia-side__hint">{query ? 'Aucun résultat.' : 'Aucune conversation pour l’instant.'}</p>
            )}
            {byProject.unassigned.map((c) => (
              <ConversationRow
                key={c.id}
                conv={c}
                active={c.id === activeId}
                projects={store.projects}
                currentProject={null}
                menuOpen={menuFor === c.id}
                onToggleMenu={() => setMenuFor((m) => (m === c.id ? null : c.id))}
                onSelect={() => handleSelect(c.id)}
                onAssign={(pid) => assign(c.id, pid)}
              />
            ))}
          </div>

          {/* Panneau Paramètres */}
          {showSettings && <SettingsPanel uid={uid} onClose={() => setShowSettings(false)} />}

          {/* Pied : compte + paramètres */}
          <div className="mzia-side__foot">
            <button type="button" className="mzia-foot__btn" onClick={() => setShowSettings((s) => !s)}>
              <Settings size={16} />
              <span>Paramètres</span>
            </button>
            {email && (
              <div className="mzia-foot__user" title={email}>
                <span className="mzia-foot__avatar">{email.slice(0, 1).toUpperCase()}</span>
                <span className="mzia-foot__email">{email}</span>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

/* ------------------------- Ligne de conversation ------------------------ */

interface RowProps {
  conv: Conversation;
  active: boolean;
  projects: Project[];
  currentProject: string | null;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onSelect: () => void;
  onAssign: (projectId: string | null) => void;
}
function ConversationRow({ conv, active, projects, currentProject, menuOpen, onToggleMenu, onSelect, onAssign }: RowProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onToggleMenu(); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen, onToggleMenu]);

  return (
    <div className={`mzia-conv ${active ? 'is-active' : ''}`} ref={ref}>
      <button type="button" className="mzia-conv__main" onClick={onSelect} title={convTitle(conv)}>
        <MessageSquare size={14} />
        <span className="mzia-conv__title">{convTitle(conv)}</span>
      </button>
      <button type="button" className="mzia-conv__menu" onClick={onToggleMenu} title="Options">
        <MoreHorizontal size={15} />
      </button>
      {menuOpen && (
        <div className="mzia-conv__dropdown">
          <p className="mzia-dropdown__label">Classer dans…</p>
          {projects.length === 0 && <p className="mzia-dropdown__empty">Aucun projet</p>}
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`mzia-dropdown__item ${currentProject === p.id ? 'is-current' : ''}`}
              onClick={() => onAssign(p.id)}
            >
              <span className="mzia-proj__dot" style={{ background: p.color }} />
              {p.name}
            </button>
          ))}
          {currentProject && (
            <button type="button" className="mzia-dropdown__item mzia-dropdown__item--muted" onClick={() => onAssign(null)}>
              Retirer du projet
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------- Paramètres -------------------------------- */

function SettingsPanel({ uid, onClose }: { uid: string | null; onClose: () => void }) {
  const [learning, setLearning] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const enabled = await getLearningEnabled(); // relecture fraîche depuis la DB
      if (alive) setLearning(enabled);
    })();
    return () => { alive = false; };
  }, []);

  const toggleLearning = useCallback(async () => {
    const next = !learning;
    setLearning(next); // optimiste
    try {
      await setLearningEnabled(next); // écrit la DB ET met à jour le cache de track()
    } catch {
      setLearning(!next); // rollback si l'écriture échoue
    }
  }, [learning]);

  const purge = useCallback(async () => {
    if (!window.confirm('Effacer tout ce que MimmozIA a appris sur vous ? Cette action est irréversible.')) return;
    setBusy(true); setMsg(null);
    try {
      await purgeMyAiMemory();
      setMsg('Mémoire effacée.');
    } catch {
      setMsg('Échec de la purge.');
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="mzia-settings">
      <div className="mzia-settings__head">
        <span><Sparkles size={14} /> Apprentissage</span>
        <button type="button" className="mzia-settings__close" onClick={onClose}>×</button>
      </div>

      <label className="mzia-settings__row">
        <span>
          Apprentissage des habitudes
          <small>MimmozIA personnalise l’accueil et les suggestions.</small>
        </span>
        <button
          type="button"
          className={`mzia-toggle ${learning ? 'is-on' : ''}`}
          onClick={toggleLearning}
          role="switch"
          aria-checked={learning}
        >
          <span className="mzia-toggle__knob" />
        </button>
      </label>

      <button type="button" className="mzia-settings__danger" onClick={purge} disabled={busy}>
        <Trash2 size={14} /> {busy ? 'Effacement…' : 'Effacer ma mémoire IA'}
      </button>
      {msg && <p className="mzia-settings__msg">{msg}</p>}

      <a className="mzia-settings__link" href="/compte" title="Paramètres du compte">
        <LogOut size={14} /> Paramètres du compte
      </a>
      {/* ⚠️ route /compte supposée — remplace par ta vraie route ComptePage si besoin */}
    </div>
  );
}

/* =========================================================================
   INTEGRATION — à confirmer une seule fois
   -------------------------------------------------------------------------
   1) LISTE des conversations : pickConversations() cherche, sur l'objet
      useCopilot, l'un de : conversations | conversationList | history |
      threads | chats (tableau d'objets ayant `id` ou `conversation_id`).
      Chaque item peut porter title / messages / created_at / updated_at.
      → Si ta liste n'apparaît pas, dis-moi le nom réel du champ.

   2) OUVRIR une conversation : pickSelect() cherche l'une de :
      selectConversation | openConversation | loadConversation |
      switchConversation | setActiveConversation | setConversationId |
      setActiveConversationId. Si aucune ne matche, un warning console
      s'affiche au clic → indique-moi la vraie fonction.

   3) PROJETS : persistés en localStorage `u:{uid}:mzia.projects`. Pour du
      multi-appareils, je bascule vers une table Supabase `conversation_projects`
      (project_id, conversation_id, user_id) — l'UI ne change pas.

   4) Table user_ai_preferences : filtre par `user_id` supposé. RPC
      `purge_my_ai_memory` (confirmée P1). Route compte `/compte` supposée.
   ========================================================================= */