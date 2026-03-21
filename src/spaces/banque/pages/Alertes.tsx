// FILE: src/spaces/banque/pages/Alertes.tsx

const GRAD_FIN = "linear-gradient(90deg, #26a69a 0%, #80cbc4 100%)";
const ACCENT_FIN = "#1a7a50";

export default function Alertes() {
  return (
    <div className="max-w-6xl mx-auto p-4 space-y-6">
      {/* Header banner */}
      <div style={{ background: GRAD_FIN, borderRadius: 14, padding: "20px 24px" }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>
          Financeur › Alertes
        </div>
        <div style={{ fontSize: 22, fontWeight: 600, color: "white", marginBottom: 4 }}>
          Alertes
        </div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>
          Alertes et notifications bancaires
        </div>
      </div>

      {/* Placeholder content */}
      <div
        className="bg-white p-8 text-center"
        style={{ borderRadius: 14, border: "2px dashed #c0e8d4" }}
      >
        <div className="text-4xl mb-3">🔔</div>
        <p className="text-gray-500 text-sm">Aucune alerte pour le moment.</p>
      </div>
    </div>
  );
}