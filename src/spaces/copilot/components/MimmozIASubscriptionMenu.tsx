import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown, Check, Minus, Sparkles,
  TrendingUp, Building2, Hammer, Handshake, Zap, Radar,
} from "lucide-react";
import "./MimmozIASubscriptionMenu.css";

export type PlanId = "basique" | "avance" | "pro" | "proplus";

interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  model: string;
  modules: "none" | "one" | "all";
  highlight?: boolean;
}

const PLANS: Plan[] = [
  { id: "basique", name: "Basique", tagline: "Pour démarrer", model: "MimmozIA · Haiku", modules: "none" },
  { id: "avance", name: "Avancé", tagline: "Analyses approfondies", model: "MimmozIA · Sonnet", modules: "none" },
  { id: "pro", name: "Pro", tagline: "1 métier au choix", model: "MimmozIA · Sonnet / Opus", modules: "one", highlight: true },
  { id: "proplus", name: "Pro +", tagline: "Tous les métiers", model: "MimmozIA · Sonnet / Opus", modules: "all" },
];

const MODULES = [
  { icon: TrendingUp, label: "Investissement" },
  { icon: Building2, label: "Promotion" },
  { icon: Hammer, label: "Réhabilitation" },
];

export interface MimmozIASubscriptionMenuProps {
  currentPlan?: PlanId;
  onSelectPlan?: (plan: PlanId) => void;
  className?: string;
}

type PanelPos = { top: number; left: number; width: number };

function computePos(trigger: HTMLElement): PanelPos {
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(760, window.innerWidth * 0.92);
  let left = rect.left + rect.width / 2 - width / 2; // centré sous le bouton
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
  return { top: rect.bottom + 8, left, width };
}

export function MimmozIASubscriptionMenu({ currentPlan, onSelectPlan, className }: MimmozIASubscriptionMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // position (portail en position: fixed → échappe à tous les stacking contexts)
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    setPos(computePos(triggerRef.current));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => { if (triggerRef.current) setPos(computePos(triggerRef.current)); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const currentName = PLANS.find((p) => p.id === currentPlan)?.name;

  const choose = useCallback((id: PlanId) => {
    onSelectPlan?.(id);
    setOpen(false);
  }, [onSelectPlan]);

  const panel = open && pos ? createPortal(
    <div
      ref={panelRef}
      className="mzia-sub__panel"
      role="menu"
      style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 1000 }}
    >
      <div className="mzia-sub__grid">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === currentPlan;
          return (
            <div key={plan.id} className={`mzia-sub__card${plan.highlight ? " is-highlight" : ""}`}>
              {plan.highlight && <span className="mzia-sub__ribbon">Populaire</span>}
              <div className="mzia-sub__name">{plan.name}</div>
              <div className="mzia-sub__tagline">{plan.tagline}</div>

              <ul className="mzia-sub__features">
                <li><Check size={13} /><span>{plan.model}</span></li>

                {plan.modules === "none" && (
                  <li className="is-muted"><Minus size={13} /><span>Modules métiers non inclus</span></li>
                )}
                {plan.modules === "one" && (
                  <li><Check size={13} /><span>1 module au choix</span></li>
                )}
                {plan.modules === "all" && (
                  <li><Check size={13} /><span>Les 3 modules inclus</span></li>
                )}

                {plan.modules !== "none" && (
                  <li className="mzia-sub__modules">
                    {MODULES.map(({ icon: Icon, label }) => (
                      <span key={label} className="mzia-sub__mod" title={label}>
                        <Icon size={12} />{label}
                      </span>
                    ))}
                  </li>
                )}

                <li><Handshake size={13} /><span>Apport d'affaires</span></li>
                <li><Zap size={13} /><span>Analyse rapide</span></li>
                <li><Radar size={13} /><span>Veille marché</span></li>
              </ul>

              <button
                type="button"
                className="mzia-sub__cta"
                disabled={isCurrent}
                onClick={() => choose(plan.id)}
              >
                {isCurrent ? "Formule actuelle" : "Choisir"}
              </button>
            </div>
          );
        })}
      </div>
      <p className="mzia-sub__foot">
        Apport d'affaires, Analyse rapide et Veille marché sont inclus dans toutes les formules. L'API est disponible séparément.
      </p>
    </div>,
    document.body,
  ) : null;

  return (
    <div className={`mzia-sub${className ? ` ${className}` : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="mzia-sub__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Sparkles size={15} />
        <span>{currentName ? `MimmozIA ${currentName}` : "Abonnements MimmozIA"}</span>
        <ChevronDown size={15} className={`mzia-sub__chev${open ? " is-open" : ""}`} />
      </button>
      {panel}
    </div>
  );
}

export default MimmozIASubscriptionMenu;