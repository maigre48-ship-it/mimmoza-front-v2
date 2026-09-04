// src/components/ui/Button.tsx
// Primitive Button du module Agent commercial. Style calqué sur l'admin actuel
// (accent slate-950, coins arrondis, bordures slate-200). Ne pas utiliser pour
// refactoriser les pages admin existantes.

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: ReactNode;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-slate-950 text-white hover:bg-slate-800 disabled:hover:bg-slate-950",
  secondary:
    "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:hover:bg-white",
  ghost: "text-slate-600 hover:bg-slate-100 disabled:hover:bg-transparent",
  danger: "bg-rose-600 text-white hover:bg-rose-700 disabled:hover:bg-rose-600",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  leftIcon,
  className = "",
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-2xl font-medium transition-all",
        "disabled:cursor-not-allowed disabled:opacity-60",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      ].join(" ")}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        leftIcon
      )}
      {children}
    </button>
  );
}
