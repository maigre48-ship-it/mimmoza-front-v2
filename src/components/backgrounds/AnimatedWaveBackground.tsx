// src/components/backgrounds/AnimatedWaveBackground.tsx
// ─── changelog ───────────────────────────────────────────────────────────────
// • Vagues milieu : Y abaissé (320→360) + amplitude agrandie (A=130–150)
//   → plongée de ~160–180px vers le bas, suit la courbe du fond
// • strokeInv (creux-en-premier) : le creux descend à Y+A ≈ 470–510
//   ce qui correspond visuellement au creux du fond bleu
// • Halo élargi pour mieux fondre sur fond blanc
// ─────────────────────────────────────────────────────────────────────────────

const BG_IMAGE = "/illustrations/vagues_intro.png";

const W  = 1600;
const C1 = Math.round(W / 3);       // 533
const C2 = Math.round((W * 2) / 3); // 1067

// Vague pic-en-premier
const stroke = (Y: number, A: number) =>
  `M0,${Y} C${C1},${Y-A} ${C2},${Y+A} ${W},${Y} C${W+C1},${Y-A} ${W+C2},${Y+A} ${W*2},${Y}`;

// Vague creux-en-premier (phase inversée)
const strokeInv = (Y: number, A: number) =>
  `M0,${Y} C${C1},${Y+A} ${C2},${Y-A} ${W},${Y} C${W+C1},${Y+A} ${W+C2},${Y-A} ${W*2},${Y}`;

// Fill fermé vers y=900
const fill = (Y: number, A: number) =>
  `${stroke(Y, A)} L${W*2},900 L0,900 Z`;

const fillInv = (Y: number, A: number) =>
  `${strokeInv(Y, A)} L${W*2},900 L0,900 Z`;

export default function AnimatedWaveBackground() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        overflow: "hidden",
        backgroundImage: `url(${BG_IMAGE})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <style>{`
        @keyframes mw-t   { from{transform:translateX(0)} to{transform:translateX(-50%)} }
        @keyframes mw-p   { 0%,100%{opacity:0.55} 50%{opacity:0.85} }
        @keyframes mw-pm  { 0%,100%{opacity:0.30} 50%{opacity:0.52} }

        .mw-track {
          position:absolute; width:200%; height:100%; top:0; left:0;
          will-change:transform;
        }
        /* Bas */
        .mw-f18 { animation:mw-t 18s linear infinite; }
        .mw-f27 { animation:mw-t 27s linear infinite; }
        .mw-f40 { animation:mw-t 40s linear infinite; }
        /* Milieu haut */
        .mw-f30 { animation:mw-t 30s linear infinite; }
        .mw-f45 { animation:mw-t 45s linear infinite; }
        /* Milieu centre */
        .mw-f38 { animation:mw-t 38s linear infinite; }

        .mw-p  { animation:mw-p   9s ease-in-out infinite; }
        .mw-pm { animation:mw-pm 12s ease-in-out infinite; }
      `}</style>

      {/* Filtres partagés */}
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <defs>
          <filter id="b4" ><feGaussianBlur stdDeviation="4"  /></filter>
          <filter id="b6" ><feGaussianBlur stdDeviation="6"  /></filter>
          <filter id="b8" ><feGaussianBlur stdDeviation="8"  /></filter>
          <filter id="b12"><feGaussianBlur stdDeviation="12" /></filter>
          <filter id="b2" ><feGaussianBlur stdDeviation="2"  /></filter>
          <radialGradient id="mw-rg" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="white" stopOpacity="1"/>
            <stop offset="100%" stopColor="white" stopOpacity="0"/>
          </radialGradient>
        </defs>
      </svg>

      {/* ══════════════════════════════════════════════════════════════════
       * MILIEU — layer A · 30 s
       * Y=320, A=150 (creux-en-premier) → plonge jusqu'à Y+A = 470
       * strokeInv : le creux apparaît à x≈400, la crête à x≈1200
       * ══════════════════════════════════════════════════════════════════ */}
      <div className="mw-track mw-f30">
        <svg width="100%" height="100%" viewBox="0 0 3200 900"
             preserveAspectRatio="xMinYMid slice" xmlns="http://www.w3.org/2000/svg">
          {/* Halo large — donne le volume de la vague */}
          <path d={strokeInv(320, 150)}
                fill="none" stroke="#60a5fa" strokeWidth="30"
                opacity="0.10" filter="url(#b8)"/>
          {/* Trait principal */}
          <path d={strokeInv(320, 150)}
                fill="none" stroke="#3b82f6" strokeWidth="2"
                filter="url(#b4)" className="mw-pm"/>
          {/* Reflet blanc */}
          <path d={strokeInv(320, 150)}
                fill="none" stroke="white" strokeWidth="0.9"
                opacity="0.45" filter="url(#b2)"/>
        </svg>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
       * MILIEU — layer B · 45 s
       * Y=360, A=130 (pic-en-premier) → plonge jusqu'à Y+A = 490
       * stroke : phase décalée de 180° par rapport au layer A
       * ══════════════════════════════════════════════════════════════════ */}
      <div className="mw-track mw-f45">
        <svg width="100%" height="100%" viewBox="0 0 3200 900"
             preserveAspectRatio="xMinYMid slice" xmlns="http://www.w3.org/2000/svg">
          {/* Halo */}
          <path d={stroke(360, 130)}
                fill="none" stroke="#93c5fd" strokeWidth="22"
                opacity="0.08" filter="url(#b8)"/>
          {/* Trait */}
          <path d={stroke(360, 130)}
                fill="none" stroke="#60a5fa" strokeWidth="1.4"
                filter="url(#b4)" className="mw-pm"/>
          {/* Reflet */}
          <path d={stroke(360, 130)}
                fill="none" stroke="white" strokeWidth="0.6"
                opacity="0.35" filter="url(#b2)"/>
        </svg>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
       * CENTRE — layer C · 38 s
       * Y=530, A=90 (creux-en-premier) → plonge jusqu'à Y+A = 620
       * Zone charnière entre les vagues du milieu et celles du bas
       * ══════════════════════════════════════════════════════════════════ */}
      <div className="mw-track mw-f38">
        <svg width="100%" height="100%" viewBox="0 0 3200 900"
             preserveAspectRatio="xMinYMid slice" xmlns="http://www.w3.org/2000/svg">
          <path d={strokeInv(530, 90)}
                fill="none" stroke="#60a5fa" strokeWidth="26"
                opacity="0.09" filter="url(#b8)"/>
          <path d={strokeInv(530, 90)}
                fill="none" stroke="#3b82f6" strokeWidth="1.6"
                filter="url(#b4)" className="mw-pm"/>
          <path d={strokeInv(530, 90)}
                fill="none" stroke="white" strokeWidth="0.7"
                opacity="0.40" filter="url(#b2)"/>
        </svg>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
       * BAS — vague principale bleue · 18 s · Y=720, A=110
       * ══════════════════════════════════════════════════════════════════ */}
      <div className="mw-track mw-f18">
        <svg width="100%" height="100%" viewBox="0 0 3200 900"
             preserveAspectRatio="xMinYMid slice" xmlns="http://www.w3.org/2000/svg">
          <path d={fill(720, 110)}
                fill="rgba(59,130,246,0.26)" filter="url(#b12)" className="mw-p"/>
          <path d={stroke(720, 110)}
                fill="none" stroke="#3b82f6" strokeWidth="2.8" filter="url(#b8)"/>
          <path d={stroke(720, 110)}
                fill="none" stroke="white" strokeWidth="1.2" opacity="0.7" filter="url(#b2)"/>
        </svg>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
       * BAS — vague bleu-ciel inversée · 27 s · Y=790, A=80
       * ══════════════════════════════════════════════════════════════════ */}
      <div className="mw-track mw-f27">
        <svg width="100%" height="100%" viewBox="0 0 3200 900"
             preserveAspectRatio="xMinYMid slice" xmlns="http://www.w3.org/2000/svg">
          <path d={fillInv(790, 80)}
                fill="rgba(96,165,250,0.20)" filter="url(#b12)"/>
          <path d={strokeInv(790, 80)}
                fill="none" stroke="#60a5fa" strokeWidth="2.2" filter="url(#b8)"/>
          <path d={strokeInv(790, 80)}
                fill="none" stroke="white" strokeWidth="0.8" opacity="0.55" filter="url(#b2)"/>
        </svg>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
       * BAS — vague azur + reflets nacre · 40 s · Y=650, A=75
       * ══════════════════════════════════════════════════════════════════ */}
      <div className="mw-track mw-f40">
        <svg width="100%" height="100%" viewBox="0 0 3200 900"
             preserveAspectRatio="xMinYMid slice" xmlns="http://www.w3.org/2000/svg">
          <path d={fill(650, 75)}
                fill="rgba(147,197,253,0.16)" filter="url(#b12)"/>
          <path d={stroke(650, 75)}
                fill="none" stroke="#93c5fd" strokeWidth="1.8" filter="url(#b8)"/>
          {/* Lignes nacre */}
          <path d={stroke(736, 110)}
                fill="none" stroke="white" strokeWidth="1.6" filter="url(#b2)" className="mw-p"/>
          <path d={stroke(752, 110)}
                fill="none" stroke="white" strokeWidth="0.6" opacity="0.5" filter="url(#b2)"/>
          {/* Glints */}
          {[267, 800, 1333, 1867, 2400, 2933].map((cx, i) => (
            <ellipse key={i} cx={cx} cy={720} rx={i % 2 === 0 ? 15 : 11} ry={i % 2 === 0 ? 6 : 4}
                     fill="url(#mw-rg)" opacity="0.8"/>
          ))}
        </svg>
      </div>
    </div>
  );
}