type Tone =
  | "emerald"
  | "amber"
  | "rose"
  | "slate"
  | "sky"
  | "violet";

function getToneClasses(tone: Tone): string {
  switch (tone) {
    case "emerald":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "amber":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "rose":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "sky":
      return "bg-sky-50 text-sky-700 border-sky-200";
    case "violet":
      return "bg-violet-50 text-violet-700 border-violet-200";
    default:
      return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

export function StatusBadge({
  label,
  tone = "slate",
}: {
  label: string;
  tone?: Tone;
}) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        getToneClasses(tone),
      ].join(" ")}
    >
      {label}
    </span>
  );
}