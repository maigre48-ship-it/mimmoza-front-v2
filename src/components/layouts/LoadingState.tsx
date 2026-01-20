
interface LoadingStateProps {
  text?: string;
  fullScreen?: boolean;
}

export const LoadingState: React.FC<LoadingStateProps> = ({ text = "Chargement...", fullScreen = false }) => {
  const content = (
    <div className="flex flex-col items-center justify-center gap-4">
      <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
      <p className="text-slate-600 font-medium">{text}</p>
    </div>
  );

  if (fullScreen) {
    return <div className="fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50">{content}</div>;
  }

  return <div className="py-12">{content}</div>;
};


