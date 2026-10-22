// src/pages/aide/AidePage.tsx
//
// Centre d'aide PUBLIC (/aide) — indexable (cf. RobotsPolicy) : aucune donnée
// DVF, uniquement le fonctionnement du produit et la grille de grille.ts.
// Contenu : ./contenuFaq.tsx. Recherche simple, sans dépendance, sur le texte
// réellement affiché (questions + réponses + mots-clés).

import { ChevronDown, LifeBuoy, Mail, Search, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { CONTACT_ACCES } from "@/lib/billing/grille";

import { DELAI_REPONSE_VISE, RUBRIQUES_FAQ } from "./contenuFaq";
import { correspond } from "./rechercheAide";

export default function AidePage() {
  const { hash } = useLocation();
  const [recherche, setRecherche] = useState("");
  // Texte affiché de chaque réponse, lu dans le DOM une fois rendu : la
  // recherche porte ainsi sur ce que le visiteur voit, chiffres compris.
  const reponsesRef = useRef<Record<string, HTMLDivElement | null>>({});
  const [textes, setTextes] = useState<Record<string, string>>({});

  useEffect(() => {
    const precedent = document.title;
    document.title = "Centre d'aide — Mimmoza";
    return () => { document.title = precedent; };
  }, []);

  useEffect(() => {
    const lus: Record<string, string> = {};
    for (const [id, el] of Object.entries(reponsesRef.current)) lus[id] = el?.textContent ?? "";
    setTextes(lus);
  }, []);

  // Lien direct vers une question (/aide#quota-analyses) : on l'ouvre.
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el instanceof HTMLDetailsElement) el.open = true;
    el?.scrollIntoView({ block: "start" });
  }, [hash]);

  const resultats = useMemo(() => {
    return RUBRIQUES_FAQ.map((r) => ({
      ...r,
      questions: r.questions.filter((q) =>
        correspond(`${r.titre} ${q.question} ${q.motsCles ?? ""} ${textes[q.id] ?? ""}`, recherche),
      ),
    }));
  }, [recherche, textes]);

  const nbResultats = resultats.reduce((n, r) => n + r.questions.length, 0);
  const rechercheActive = recherche.trim().length > 0;

  return (
    <div className="bg-slate-50">
      {/* ── En-tête ─────────────────────────────────────────────────────── */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:py-14">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 shadow-sm">
            <LifeBuoy className="h-3.5 w-3.5 text-violet-500" aria-hidden="true" />
            Centre d'aide
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Comment pouvons-nous vous aider ?
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-500">
            Les réponses aux questions les plus fréquentes sur Mimmoza : démarrer, analyses, Mimmo, exports, jetons
            et formules.
          </p>

          <div className="relative mt-6 max-w-2xl">
            <label htmlFor="aide-recherche" className="sr-only">Rechercher dans l'aide</label>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              id="aide-recherche"
              type="search"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Rechercher : jetons, export, supprimer mon compte…"
              autoComplete="off"
              className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-12 pr-11 text-base text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-100 [&::-webkit-search-cancel-button]:appearance-none"
            />
            {rechercheActive && (
              <button
                type="button"
                onClick={() => setRecherche("")}
                className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Effacer la recherche"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="mt-2 min-h-[1.25rem] text-sm text-slate-500" aria-live="polite">
            {rechercheActive &&
              (nbResultats === 0
                ? "Aucune réponse ne correspond à votre recherche."
                : `${nbResultats} réponse${nbResultats > 1 ? "s" : ""} trouvée${nbResultats > 1 ? "s" : ""}`)}
          </p>
        </div>
      </section>

      {/* ── Corps ───────────────────────────────────────────────────────── */}
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[13rem_1fr]">
        <nav aria-label="Rubriques de l'aide" className="hidden lg:block">
          <ul className="sticky top-40 space-y-1 text-sm">
            {RUBRIQUES_FAQ.map((r) => (
              <li key={r.id}>
                <a href={`#${r.id}`} className="block rounded-lg px-3 py-1.5 text-slate-600 transition hover:bg-white hover:text-slate-950">
                  {r.titre}
                </a>
              </li>
            ))}
            <li className="pt-3">
              <Link to="/securite" className="flex items-center gap-2 rounded-lg px-3 py-1.5 font-medium text-violet-700 hover:bg-white">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Sécurité et données
              </Link>
            </li>
          </ul>
        </nav>

        <div className="min-w-0 space-y-10">
          {resultats.map((r) => (
            <section
              key={r.id}
              id={r.id}
              aria-labelledby={`${r.id}-titre`}
              className="scroll-mt-40"
              hidden={r.questions.length === 0}
            >
              <h2 id={`${r.id}-titre`} className="mb-3 text-lg font-semibold text-slate-950">{r.titre}</h2>
              <div className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {RUBRIQUES_FAQ.find((x) => x.id === r.id)!.questions.map((q) => {
                  const visible = r.questions.some((v) => v.id === q.id);
                  return (
                    <details
                      key={q.id}
                      id={q.id}
                      hidden={!visible}
                      open={rechercheActive && visible ? true : undefined}
                      className="group scroll-mt-40"
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left text-[15px] font-medium text-slate-900 transition hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                        <span>{q.question}</span>
                        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true" />
                      </summary>
                      <div
                        ref={(el) => { reponsesRef.current[q.id] = el; }}
                        className="px-5 pb-5 text-[15px] leading-7 text-slate-600"
                      >
                        {q.reponse}
                      </div>
                    </details>
                  );
                })}
              </div>
            </section>
          ))}

          {/* ── Contact ───────────────────────────────────────────────── */}
          <section aria-labelledby="aide-contact" className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-6">
            <h2 id="aide-contact" className="text-lg font-semibold text-slate-950">Vous n'avez pas trouvé votre réponse ?</h2>
            <p className="mt-2 text-[15px] leading-7 text-slate-600">
              Écrivez-nous en précisant l'adresse e-mail de votre compte et la page concernée. Nous visons une réponse
              sous {DELAI_REPONSE_VISE}.
            </p>
            <a
              href={`mailto:${CONTACT_ACCES}?subject=${encodeURIComponent("Question sur Mimmoza")}`}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <Mail className="h-4 w-4" aria-hidden="true" /> {CONTACT_ACCES}
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}
