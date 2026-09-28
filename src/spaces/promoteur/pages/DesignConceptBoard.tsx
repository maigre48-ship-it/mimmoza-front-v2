import { programmeKind } from './projectProgramme';
import type { DesignDirection } from './designDirections';

const color = (value: string | undefined, fallback: string) => value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;

/** Croquis de direction calculé avec la palette du brief, sans prétention de gabarit ou de conformité. */
export function DesignConceptBoard({ direction, programme }: { direction: DesignDirection; programme: string }) {
  const [base, mid, accent] = [color(direction.palette[0]?.hex, '#EEE9DF'), color(direction.palette[1]?.hex, '#B6A68F'),
    color(direction.palette[2]?.hex, '#39444B')];
  const kind = programmeKind(programme);
  const sleeping = kind === 'hotel' || kind === 'ehpad' || kind === 'student';
  const care = kind === 'clinic';
  const retail = kind === 'retail';
  const windows = [0, 1, 2].flatMap((row) => [0, 1, 2].map((column) => ({ x: 58 + column * 44, y: 85 + row * 40 })));
  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
    <svg viewBox="0 0 460 260" role="img" aria-label={`Croquis conceptuel de façade et d'intérieur : ${direction.title}`} className="block w-full">
      <rect width="230" height="240" fill="#DDE7EA" /><rect x="230" width="230" height="240" fill={base} />
      <path d="M0 200 Q90 178 230 203 V240 H0Z" fill="#AFC2AE" />
      {direction.family === 'durable' && <path d="M35 75 L126 40 L217 75Z" fill={accent} />}
      {direction.family !== 'durable' && <rect x="35" y="58" width="182" height="18" fill={accent} />}
      <rect x="42" y="75" width="168" height="124" rx={direction.family === 'contemporain' ? 1 : 4} fill={base} stroke={accent} strokeWidth="2" />
      {direction.family === 'expressif' && <rect x="42" y="75" width="18" height="124" fill={mid} />}
      {windows.map((window) => <g key={`${window.x}-${window.y}`}><rect x={window.x} y={window.y} width="24" height="27" fill="#BCD8DE" stroke={accent} strokeWidth="2" />
        <path d={`M${window.x + 12} ${window.y} V${window.y + 27}`} stroke={accent} strokeWidth="1" /></g>)}
      <rect x="111" y="169" width="29" height="30" fill={accent} /><rect x="114" y="173" width="10" height="18" fill="#BCD8DE" />
      {direction.family === 'contemporain' && <path d="M50 158 H203" stroke={mid} strokeWidth="6" />}
      <rect x="238" y="35" width="214" height="177" rx="10" fill="#FFFFFF" fillOpacity="0.42" />
      <rect x="258" y="54" width="74" height="80" fill="#D5E4E5" stroke={accent} strokeWidth="3" />
      <path d="M295 54 V134 M258 94 H332" stroke={accent} strokeWidth="2" />
      <path d="M247 188 H445" stroke={mid} strokeWidth="17" />
      {sleeping ? <g><rect x="337" y="145" width="92" height="35" rx="5" fill={accent} /><rect x="345" y="139" width="82" height="27" rx="5" fill={base} /><rect x="348" y="139" width="27" height="12" rx="4" fill="#FFFFFF" /></g>
        : care ? <g><rect x="340" y="145" width="88" height="24" rx="5" fill={accent} /><rect x="348" y="139" width="73" height="24" rx="5" fill={base} /></g>
          : retail ? <g><rect x="351" y="78" width="12" height="95" fill={accent} /><rect x="420" y="78" width="12" height="95" fill={accent} /><path d="M351 86 H432 M351 119 H432 M351 152 H432" stroke={mid} strokeWidth="9" /></g>
            : <g><rect x="341" y="147" width="90" height="28" rx="8" fill={accent} /><rect x="348" y="136" width="75" height="22" rx="8" fill={mid} /></g>}
      <circle cx="269" cy="165" r="14" fill={mid} /><path d="M269 179 V199" stroke={accent} strokeWidth="5" />
      <rect y="238" width="460" height="22" fill="#FFFFFF" />
      <text x="16" y="253" fontSize="11" fill="#334155">Façade conceptuelle</text><text x="246" y="253" fontSize="11" fill="#334155">Ambiance intérieure</text>
    </svg>
    <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">Croquis de palette et d’intention · ni plan, ni rendu du terrain</p>
  </div>;
}
