
interface PageContainerProps {
  children: React.ReactNode;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "full";
  padding?: boolean;
}

const maxWidthClasses: Record<NonNullable<PageContainerProps["maxWidth"]>, string> = {
  sm: "max-w-2xl",
  md: "max-w-4xl",
  lg: "max-w-5xl",
  xl: "max-w-6xl",
  "2xl": "max-w-7xl",
  full: "max-w-full",
};

export const PageContainer: React.FC<PageContainerProps> = ({
  children,
  maxWidth = "2xl",
  padding = true,
}) => {
  return (
    <div
      className={`mx-auto ${maxWidthClasses[maxWidth]} ${
        padding ? "px-4" : ""
      }`}
    >
      {children}
    </div>
  );
};


