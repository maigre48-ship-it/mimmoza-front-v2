// src/spaces/promoteur/etudes/EtudesLayout.tsx
import React from "react";
import { Sparkles } from "lucide-react";

// ============================================
// COLORS (shared)
// ============================================
export const EtudesColors = {
  primary: "#2563eb",
  primaryLight: "#eff6ff",
  primaryBorder: "#bfdbfe",
  secondary: "#4f46e5",
  accent: "#7c3aed",
  text: "#0f172a",
  textMuted: "#64748b",
  border: "#e2e8f0",
  bgLight: "#f8fafc",
  bgCard: "#ffffff",
  warning: "#fbbf24",
  warningLight: "#fef3c7",
  warningDark: "#92400e",
};

// ============================================
// LAYOUT STYLES
// ============================================
const layoutContainer: React.CSSProperties = {
  minHeight: "100%",
  background: `linear-gradient(135deg, ${EtudesColors.bgLight} 0%, #ffffff 50%, #eef2ff 100%)`,
  padding: "32px",
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const topbarStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  marginBottom: "28px",
};

const titleBlock: React.CSSProperties = {
  flex: 1,
};

const pageTitleStyle: React.CSSProperties = {
  fontSize: "28px",
  fontWeight: 700,
  color: EtudesColors.text,
  marginBottom: "8px",
  letterSpacing: "-0.02em",
  lineHeight: 1.2,
};

const pageSubtitleStyle: React.CSSProperties = {
  fontSize: "15px",
  color: EtudesColors.textMuted,
  lineHeight: 1.6,
  maxWidth: "600px",
};

const actionsBlock: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
};

const contentGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 400px",
  gap: "24px",
  alignItems: "start",
};

const sidePanelStyle: React.CSSProperties = {
  background: EtudesColors.bgCard,
  borderRadius: "20px",
  border: `1px solid ${EtudesColors.border}`,
  padding: "24px",
  boxShadow: "0 4px 20px rgba(15, 23, 42, 0.06)",
};

const mainContentStyle: React.CSSProperties = {
  background: EtudesColors.bgCard,
  borderRadius: "20px",
  border: `1px solid ${EtudesColors.border}`,
  padding: "24px",
  boxShadow: "0 4px 20px rgba(15, 23, 42, 0.06)",
  minHeight: "400px",
};

// ============================================
// LAYOUT COMPONENT
// ============================================
interface EtudesLayoutProps {
  /** Titre de la page (ex: "Étude de marché") */
  title: string;
  /** Sous-titre / description de la page */
  subtitle?: string;
  /** Contenu du panneau latéral gauche (filtres, paramètres) */
  sidePanel: React.ReactNode;
  /** Contenu principal (résultats, empty state, etc.) */
  children: React.ReactNode;
  /** Contenu optionnel de la topbar (boutons d'action, etc.) */
  topbarActions?: React.ReactNode;
}

export function EtudesLayout({
  title,
  subtitle,
  sidePanel,
  children,
  topbarActions,
}: EtudesLayoutProps) {
  return (
    <div style={layoutContainer}>
      {/* TOPBAR */}
      <header style={topbarStyle}>
        <div style={titleBlock}>
          <h1 style={pageTitleStyle}>{title}</h1>
          {subtitle && <p style={pageSubtitleStyle}>{subtitle}</p>}
        </div>
        {topbarActions && <div style={actionsBlock}>{topbarActions}</div>}
      </header>

      {/* CONTENT GRID */}
      <div style={contentGrid}>
        {/* SIDE PANEL (filtres) */}
        <div style={sidePanelStyle}>{sidePanel}</div>

        {/* MAIN CONTENT */}
        <div style={mainContentStyle}>{children}</div>
      </div>
    </div>
  );
}

// ============================================
// PANEL HEADER
// ============================================
interface PanelHeaderProps {
  icon: React.ReactNode;
  title: string;
}

const panelHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  marginBottom: "20px",
};

const panelIconBox: React.CSSProperties = {
  width: "40px",
  height: "40px",
  borderRadius: "12px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: `linear-gradient(135deg, ${EtudesColors.primaryLight}, #dbeafe)`,
};

const panelTitleStyle: React.CSSProperties = {
  fontSize: "16px",
  fontWeight: 600,
  color: EtudesColors.text,
};

export function PanelHeader({ icon, title }: PanelHeaderProps) {
  return (
    <div style={panelHeaderStyle}>
      <div style={panelIconBox}>{icon}</div>
      <h2 style={panelTitleStyle}>{title}</h2>
    </div>
  );
}

// ============================================
// FORM FIELD
// ============================================
interface FormFieldProps {
  label: string;
  children: React.ReactNode;
}

const fieldStyle: React.CSSProperties = {
  marginBottom: "20px",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "11px",
  fontWeight: 700,
  color: EtudesColors.textMuted,
  marginBottom: "8px",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

export function FormField({ label, children }: FormFieldProps) {
  return (
    <div style={fieldStyle}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

// ============================================
// TEXT INPUT
// ============================================
interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "14px 16px",
  borderRadius: "12px",
  border: `1px solid ${EtudesColors.border}`,
  fontSize: "14px",
  color: EtudesColors.text,
  background: EtudesColors.bgLight,
  outline: "none",
  transition: "all 0.2s ease",
  boxSizing: "border-box",
};

export function TextInput(props: TextInputProps) {
  return <input style={inputStyle} {...props} />;
}

// ============================================
// INPUT ROW (2 columns)
// ============================================
interface InputRowProps {
  children: React.ReactNode;
}

const inputRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "12px",
};

export function InputRow({ children }: InputRowProps) {
  return <div style={inputRowStyle}>{children}</div>;
}

// ============================================
// DIVIDER WITH TEXT
// ============================================
interface DividerProps {
  text?: string;
}

const dividerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "16px",
  margin: "20px 0",
};

const dividerLineStyle: React.CSSProperties = {
  flex: 1,
  height: "1px",
  background: EtudesColors.border,
};

const dividerTextStyle: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: 500,
  color: EtudesColors.textMuted,
};

export function Divider({ text = "ou" }: DividerProps) {
  return (
    <div style={dividerStyle}>
      <div style={dividerLineStyle} />
      <span style={dividerTextStyle}>{text}</span>
      <div style={dividerLineStyle} />
    </div>
  );
}

// ============================================
// TOGGLE BUTTONS
// ============================================
interface ToggleOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

interface ToggleButtonsProps {
  options: ToggleOption[];
  value: string;
  onChange: (value: string) => void;
}

const toggleContainerStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "8px",
};

const getToggleBtnStyle = (isActive: boolean): React.CSSProperties => ({
  padding: "12px 16px",
  borderRadius: "12px",
  border: `1px solid ${isActive ? EtudesColors.primary : EtudesColors.border}`,
  background: isActive ? EtudesColors.primaryLight : EtudesColors.bgCard,
  color: isActive ? EtudesColors.primary : EtudesColors.text,
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  transition: "all 0.2s ease",
});

export function ToggleButtons({ options, value, onChange }: ToggleButtonsProps) {
  return (
    <div style={toggleContainerStyle}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          style={getToggleBtnStyle(value === opt.value)}
          onClick={() => onChange(opt.value)}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ============================================
// SLIDER FIELD
// ============================================
interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  marks?: { value: number; label: string }[];
  onChange: (value: number) => void;
}

const sliderStyle: React.CSSProperties = {
  width: "100%",
  height: "8px",
  borderRadius: "4px",
  cursor: "pointer",
  accentColor: EtudesColors.primary,
};

const sliderMarksStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  marginTop: "8px",
  fontSize: "11px",
  color: EtudesColors.textMuted,
  fontWeight: 500,
};

export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  marks,
  onChange,
}: SliderFieldProps) {
  return (
    <FormField label={`${label}: ${value}${unit}`}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={sliderStyle}
      />
      {marks && (
        <div style={sliderMarksStyle}>
          {marks.map((mark) => (
            <span key={mark.value}>{mark.label}</span>
          ))}
        </div>
      )}
    </FormField>
  );
}

// ============================================
// PRIMARY BUTTON
// ============================================
interface PrimaryButtonProps {
  children: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}

const primaryBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "16px 24px",
  borderRadius: "14px",
  border: "none",
  background: `linear-gradient(135deg, ${EtudesColors.primary} 0%, ${EtudesColors.secondary} 50%, ${EtudesColors.accent} 100%)`,
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 700,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "10px",
  boxShadow: "0 12px 30px rgba(37, 99, 235, 0.35)",
  transition: "all 0.2s ease",
  marginTop: "8px",
};

export function PrimaryButton({
  children,
  icon,
  onClick,
  disabled,
  type = "button",
}: PrimaryButtonProps) {
  return (
    <button
      type={type}
      style={{
        ...primaryBtnStyle,
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      {children}
    </button>
  );
}

// ============================================
// EMPTY STATE
// ============================================
interface EmptyStateProps {
  title: string;
  description: string;
  tip?: {
    title: string;
    text: string;
  };
}

const emptyContainerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "48px 32px",
  textAlign: "center",
  minHeight: "350px",
};

const emptyIconBoxStyle: React.CSSProperties = {
  width: "100px",
  height: "100px",
  borderRadius: "28px",
  background: "linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  marginBottom: "24px",
  position: "relative",
};

const searchIconCircle: React.CSSProperties = {
  width: "56px",
  height: "56px",
  borderRadius: "50%",
  border: `6px solid ${EtudesColors.text}`,
  borderBottomColor: "transparent",
  transform: "rotate(-45deg)",
};

const searchIconHandle: React.CSSProperties = {
  position: "absolute",
  width: "18px",
  height: "6px",
  background: EtudesColors.text,
  borderRadius: "3px",
  bottom: "24px",
  right: "24px",
  transform: "rotate(45deg)",
};

const emptyTitleStyle: React.CSSProperties = {
  fontSize: "18px",
  fontWeight: 600,
  color: EtudesColors.text,
  marginBottom: "8px",
};

const emptyDescStyle: React.CSSProperties = {
  fontSize: "14px",
  color: EtudesColors.textMuted,
  maxWidth: "280px",
  lineHeight: 1.6,
};

const tipBoxStyle: React.CSSProperties = {
  marginTop: "24px",
  padding: "16px",
  borderRadius: "14px",
  background: `linear-gradient(135deg, ${EtudesColors.warningLight} 0%, #fde68a 100%)`,
  border: `1px solid ${EtudesColors.warning}`,
  width: "100%",
  maxWidth: "320px",
};

const tipTitleStyle: React.CSSProperties = {
  fontSize: "13px",
  fontWeight: 600,
  color: EtudesColors.warningDark,
  marginBottom: "4px",
  display: "flex",
  alignItems: "center",
  gap: "6px",
};

const tipTextStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "#a16207",
  lineHeight: 1.5,
};

export function EmptyState({ title, description, tip }: EmptyStateProps) {
  return (
    <div style={emptyContainerStyle}>
      <div style={emptyIconBoxStyle}>
        <div style={searchIconCircle} />
        <div style={searchIconHandle} />
      </div>
      <h3 style={emptyTitleStyle}>{title}</h3>
      <p style={emptyDescStyle}>{description}</p>
      {tip && (
        <div style={tipBoxStyle}>
          <div style={tipTitleStyle}>
            <Sparkles size={14} />
            {tip.title}
          </div>
          <p style={tipTextStyle}>{tip.text}</p>
        </div>
      )}
    </div>
  );
}

// ============================================
// DEFAULT EXPORT
// ============================================
export default EtudesLayout;