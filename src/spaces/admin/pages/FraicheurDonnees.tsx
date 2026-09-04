// src/spaces/admin/pages/FraicheurDonnees.tsx
//
// Fraîcheur des données de référence.
//
// Mimmoza s'appuie sur une trentaine de jeux de données publics qui se périment
// chacun à leur rythme. Rien ne le signalait : une donnée de 2021 s'affichait
// avec le même aplomb qu'une donnée de la semaine.
//
// Parti pris d'affichage : ce qui demande une action est en haut, toujours. Une
// page où il faut chercher les problèmes n'est pas une page d'alertes.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { StatusBadge } from "../components/StatusBadge";
import {
  chargerFraicheurDonnees,
  definirDateManuelle,
  explicationStatut,
  formatAnciennete,
  formatDate,
  formatLignes,
  libelleCadence,
  libelleStatut,
  resumer,
  toneStatut,
  type SourceFraicheur,
  type StatutFraicheur,
} from "../services/dataFreshness.service";

type LoadState = "loading" | "ready" | "error";

/** Les statuts qui appellent un geste, par opposition à ceux qui informent. */
const STATUTS_ACTIONNABLES: StatutFraicheur[] = ["perime", "vide", "table_absente"];

export default function FraicheurDonneesPage() {
  const [sources, setSources] = useState<SourceFraicheur[]>([]);
  const [etat, setEtat] = useState<LoadState>("loading");
  const [erreur, setErreur] = useState<string | null>(null);
  const [filtre, setFiltre] = useState<"tout" | "a_traiter">("tout");
  const [detailOuvert, setDetailOuvert] = useState<string | null>(null);
  const [commandeCopiee, setCommandeCopiee] = useState<string | null>(null);

  /**
   * `avecIndicateur` distingue le premier chargement du bouton « Actualiser ».
   *
   * Au montage, l'état vaut déjà « loading » : repasser par setEtat avant le
   * premier await déclencherait un rendu en cascade, que React signale
   * désormais comme une erreur. Sur un rafraîchissement manuel, en revanche, il
   * faut bien remettre la page en attente — sinon rien ne bouge à l'écran et on
   * clique deux fois.
   */
  const charger = useCallback(async (avecIndicateur: boolean) => {
    if (avecIndicateur) {
      setEtat("loading");
      setErreur(null);
    }
    try {
      setSources(await chargerFraicheurDonnees());
      setEtat("ready");
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Chargement impossible.");
      setEtat("error");
    }
  }, []);

  useEffect(() => {
    // react-hooks/set-state-in-effect signale tout appel qui finit par un
    // setState depuis un effet, y compris après un await. Charger des données
    // au montage sans bibliothèque de requêtes le demande pourtant : les 19
    // autres pages de l'espace admin ont la même dette. On la déclare ici
    // plutôt que de la masquer, en attendant une décision d'ensemble.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void charger(false);
  }, [charger]);

  const synthese = useMemo(() => resumer(sources), [sources]);

  const affichees = useMemo(
    () =>
      filtre === "tout"
        ? sources
        : sources.filter((s) => STATUTS_ACTIONNABLES.includes(s.statut)),
    [sources, filtre],
  );

  async function copierCommande(cle: string, commande: string) {
    try {
      await navigator.clipboard.writeText(commande);
      setCommandeCopiee(cle);
      window.setTimeout(() => setCommandeCopiee(null), 2000);
    } catch {
      // Le presse-papiers peut être refusé (contexte non sécurisé, permission).
      // La commande reste lisible et sélectionnable à l'écran : inutile
      // d'alerter pour un raccourci qui n'a pas fonctionné.
    }
  }

  return (
    <div className="space-y-6">
      {/* ── En-tête ───────────────────────────────────────────────────────── */}
      <header className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
              Données de référence
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">
              Fraîcheur des données
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Chaque source est mesurée sur la donnée réelle en base, pas sur une date
              déclarée : un import qui n'a pas tourné ne peut pas prétendre le contraire.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void charger(true)}
            disabled={etat === "loading"}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            {etat === "loading" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Actualiser
          </button>
        </div>

        {/* Compteurs. Le nombre à traiter est le seul qui change de couleur :
            un tableau de bord où tout clignote ne se lit plus. */}
        {etat === "ready" && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Compteur libelle="Sources suivies" valeur={synthese.total} />
            <Compteur libelle="À jour" valeur={synthese.aJour} tone="emerald" />
            <Compteur libelle="À vérifier" valeur={synthese.aVerifier} tone="amber" />
            <Compteur
              libelle="À traiter"
              valeur={synthese.aTraiter}
              tone={synthese.aTraiter > 0 ? "rose" : "slate"}
            />
          </div>
        )}
      </header>

      {/* ── Erreur ────────────────────────────────────────────────────────── */}
      {etat === "error" && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm text-amber-900">
            <div className="font-medium">Lecture impossible</div>
            <p className="mt-0.5 text-amber-800">{erreur}</p>
          </div>
        </div>
      )}

      {/* ── Chargement ────────────────────────────────────────────────────── */}
      {etat === "loading" && (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-2xl border border-slate-200 bg-slate-50"
            />
          ))}
        </div>
      )}

      {/* ── Tableau ───────────────────────────────────────────────────────── */}
      {etat === "ready" && (
        <section className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">
              {affichees.length} source{affichees.length > 1 ? "s" : ""}
            </h2>
            <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
              <Onglet actif={filtre === "tout"} onClick={() => setFiltre("tout")}>
                Toutes
              </Onglet>
              <Onglet
                actif={filtre === "a_traiter"}
                onClick={() => setFiltre("a_traiter")}
              >
                À traiter ({synthese.aTraiter})
              </Onglet>
            </div>
          </div>

          {affichees.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Check className="mx-auto h-8 w-8 text-emerald-500" />
              <p className="mt-3 text-sm text-slate-600">
                Aucune source à traiter.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-5 py-4 font-medium">Source</th>
                    <th className="px-5 py-4 font-medium">État</th>
                    <th className="px-5 py-4 font-medium">Référence</th>
                    <th className="px-5 py-4 font-medium">Ancienneté</th>
                    <th className="px-5 py-4 font-medium">Cadence</th>
                    <th className="px-5 py-4 text-right font-medium">Lignes</th>
                    <th className="px-5 py-4" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {affichees.map((s) => {
                    const ouvert = detailOuvert === s.cle;
                    return (
                      // La clé va sur le Fragment, pas sur les <tr> qu'il
                      // contient : c'est lui l'élément de la liste. Sans cela,
                      // React réconcilie mal à l'ouverture d'un détail.
                      <Fragment key={s.cle}>
                        <tr className="hover:bg-slate-50/60">
                          <td className="px-5 py-4">
                            <div className="font-medium text-slate-900">{s.libelle}</div>
                            <div className="text-xs text-slate-500">{s.categorie}</div>
                          </td>
                          <td className="px-5 py-4">
                            <StatusBadge
                              label={libelleStatut(s.statut)}
                              tone={toneStatut(s.statut)}
                            />
                          </td>
                          <td className="px-5 py-4 text-slate-700">
                            {s.modeMesure === "millesime" && s.valeurMesuree
                              ? `Millésime ${s.valeurMesuree}`
                              : formatDate(s.dateReference)}
                          </td>
                          <td className="px-5 py-4 text-slate-700">
                            {formatAnciennete(s)}
                          </td>
                          <td className="px-5 py-4 text-slate-500">
                            {libelleCadence(s.cadenceJours)}
                          </td>
                          <td className="px-5 py-4 text-right tabular-nums text-slate-700">
                            {formatLignes(s.lignes)}
                          </td>
                          <td className="px-5 py-4 text-right">
                            <button
                              type="button"
                              onClick={() => setDetailOuvert(ouvert ? null : s.cle)}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                              aria-expanded={ouvert}
                            >
                              {ouvert ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                              Détail
                            </button>
                          </td>
                        </tr>

                        {ouvert && (
                          <tr className="bg-slate-50/80">
                            <td colSpan={7} className="px-5 py-5">
                              <div className="space-y-3 text-sm">
                                <p className="text-slate-700">
                                  {explicationStatut(s.statut)}
                                </p>

                                {s.notes && (
                                  <p className="text-slate-600">{s.notes}</p>
                                )}

                                <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
                                  <Ligne libelle="Table">
                                    <code className="text-xs text-slate-700">
                                      {s.tableCible ?? "—"}
                                    </code>
                                  </Ligne>
                                  <Ligne libelle="Mesure">
                                    {s.modeMesure === "manuel"
                                      ? "date saisie à la main"
                                      : `colonne ${s.modeMesure}`}
                                  </Ligne>
                                  <Ligne libelle="Délai de grâce">
                                    {s.toleranceJours} jours au-delà de la cadence
                                  </Ligne>
                                  {s.sourceUrl && (
                                    <Ligne libelle="Source">
                                      <a
                                        href={s.sourceUrl}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                        className="inline-flex items-center gap-1 text-sky-700 hover:underline"
                                      >
                                        Jeu de données
                                        <ExternalLink className="h-3 w-3" />
                                      </a>
                                    </Ligne>
                                  )}
                                </dl>

                                {/* Sans colonne datable, la seule façon de
                                    sortir cette source de l'inconnu est de
                                    déclarer la date à la main. */}
                                {s.modeMesure === "manuel" && (
                                  <SaisieDateManuelle
                                    cle={s.cle}
                                    valeur={s.dateReference}
                                    onEnregistre={() => void charger(true)}
                                  />
                                )}

                                {s.commandeMaj && (
                                  <div>
                                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                                      Pour recharger
                                    </div>
                                    <div className="flex items-start gap-2">
                                      <code className="flex-1 overflow-x-auto rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800">
                                        {s.commandeMaj}
                                      </code>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void copierCommande(s.cle, s.commandeMaj!)
                                        }
                                        className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                                      >
                                        {commandeCopiee === s.cle ? (
                                          <>
                                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                                            Copié
                                          </>
                                        ) : (
                                          <>
                                            <Copy className="h-3.5 w-3.5" />
                                            Copier
                                          </>
                                        )}
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ── Note de lecture ───────────────────────────────────────────────── */}
      {etat === "ready" && synthese.indetermines > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
          <Database className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
          <p className="text-sm text-slate-600">
            {synthese.indetermines} source
            {synthese.indetermines > 1 ? "s ne portent" : " ne porte"} aucune colonne
            permettant de la dater. Leur ancienneté est indéterminable tant qu'une date
            n'est pas saisie dans le registre — ce n'est ni une bonne ni une mauvaise
            nouvelle, seulement une inconnue.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Fragments ────────────────────────────────────────────────────────────────

function Compteur({
  libelle,
  valeur,
  tone = "slate",
}: {
  libelle: string;
  valeur: number;
  tone?: "slate" | "emerald" | "amber" | "rose";
}) {
  const couleur =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "amber"
        ? "text-amber-700"
        : tone === "rose"
          ? "text-rose-700"
          : "text-slate-900";

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3">
      <div className={`text-2xl font-semibold tabular-nums ${couleur}`}>{valeur}</div>
      <div className="mt-0.5 text-xs text-slate-500">{libelle}</div>
    </div>
  );
}

function Onglet({
  actif,
  onClick,
  children,
}: {
  actif: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-lg px-3 py-1.5 text-xs font-medium transition",
        actif ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/**
 * Saisie de la date de chargement, pour les sources qu'aucune colonne ne date.
 *
 * On enregistre la date telle qu'elle est saisie, sans jamais proposer
 * « aujourd'hui » par défaut : un bouton qui remet la date du jour d'un clic
 * finirait par servir à faire taire l'alerte plutôt qu'à décrire la réalité.
 */
function SaisieDateManuelle({
  cle,
  valeur,
  onEnregistre,
}: {
  cle: string;
  valeur: string | null;
  onEnregistre: () => void;
}) {
  const [saisie, setSaisie] = useState(valeur ?? "");
  const [enCours, setEnCours] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  async function enregistrer() {
    setEnCours(true);
    setEchec(null);
    try {
      await definirDateManuelle(cle, saisie || null);
      onEnregistre();
    } catch (e) {
      setEchec(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
        Date de chargement
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800"
        />
        <button
          type="button"
          onClick={() => void enregistrer()}
          disabled={enCours || saisie === (valeur ?? "")}
          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        >
          {enCours && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Enregistrer
        </button>
        <span className="text-xs text-slate-500">
          Aucune colonne ne date cette table.
        </span>
      </div>
      {echec && <p className="mt-1 text-xs text-rose-700">{echec}</p>}
    </div>
  );
}

function Ligne({
  libelle,
  children,
}: {
  libelle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <dt className="text-slate-500">{libelle} :</dt>
      <dd className="text-slate-800">{children}</dd>
    </div>
  );
}
