// src/components/ui/Input.tsx
// Primitives de formulaire du module Agent commercial : Field (label + erreur),
// TextInput, Textarea, Select. Style admin clair.

import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

const BASE_FIELD =
  "w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 " +
  "placeholder:text-slate-400 transition-colors focus:border-slate-400 focus:outline-none " +
  "focus:ring-2 focus:ring-slate-100 disabled:cursor-not-allowed disabled:bg-slate-50";

export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
}: {
  label?: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
          {label}
          {required && <span className="ml-0.5 text-rose-500">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs text-rose-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput({
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={[BASE_FIELD, className].join(" ")} {...rest} />;
}

export function Textarea({
  className = "",
  rows = 3,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} className={[BASE_FIELD, className].join(" ")} {...rest} />;
}

export function Select({
  className = "",
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={[BASE_FIELD, "pr-8", className].join(" ")} {...rest}>
      {children}
    </select>
  );
}
