
interface ContentSectionProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
  card?: boolean;
  spacing?: "tight" | "normal" | "loose";
}

const spacingClasses: Record<NonNullable<ContentSectionProps["spacing"]>, string> = {
  tight: "mb-4",
  normal: "mb-8",
  loose: "mb-12",
};

export const ContentSection: React.FC<ContentSectionProps> = ({
  children,
  title,
  subtitle,
  actions,
  className = "",
  card = false,
  spacing = "normal",
}) => {
  const content = (
    <>
      {(title || subtitle || actions) && (
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex-1">
            {title && (
              <h2 className="text-xl font-bold text-slate-900 mb-1">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="text-slate-600 text-sm">{subtitle}</p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2">
              {actions}
            </div>
          )}
        </div>
      )}
      {children}
    </>
  );

  if (card) {
    return (
      <div
        className={`bg-white rounded-xl shadow-md border border-slate-200 p-6 ${spacingClasses[spacing]} ${className}`}
      >
        {content}
      </div>
    );
  }

  return (
    <div className={`${spacingClasses[spacing]} ${className}`}>
      {content}
    </div>
  );
};


