import React from "react";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  trend?: {
    value: string;
    type: "up" | "down" | "neutral";
  };
  gradient?: string;
  onClick?: () => void;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  icon,
  trend,
  gradient = "from-blue-500 to-blue-600",
  onClick,
}) => {
  const trendColors: Record<"up" | "down" | "neutral", string> = {
    up: "bg-green-100 text-green-800",
    down: "bg-red-100 text-red-800",
    neutral: "bg-slate-100 text-slate-800",
  };

  return (
    <div
      className={`bg-white rounded-xl shadow-md p-6 border border-slate-200 hover:shadow-lg transition-shadow ${
        onClick ? "cursor-pointer" : ""
      }`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-4">
        {icon && (
          <div
            className={`w-12 h-12 bg-gradient-to-br ${gradient} rounded-xl flex items-center justify-center shadow-lg text-2xl`}
          >
            {icon}
          </div>
        )}
        {trend && (
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
              trendColors[trend.type]
            }`}
          >
            {trend.type === "up" && "? "}
            {trend.type === "down" && "? "}
            {trend.value}
          </span>
        )}
      </div>

      <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-1">
        {title}
      </h3>
      <p className="text-3xl font-bold text-slate-900 mb-1">{value}</p>
      {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
    </div>
  );
};

