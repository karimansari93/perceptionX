
interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
}

export const LoadingSpinner = ({ size = 'md', text }: LoadingSpinnerProps) => {
  const sizeClasses = {
    sm: 'h-8 w-8',
    md: 'h-16 w-16',
    lg: 'h-32 w-32'
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <img
          alt="Perception Logo"
          className={`object-contain ${sizeClasses[size]} mx-auto mb-4 animate-pulse`}
          src="/logos/PinkBadge.png"
        />
        {text && <p className="text-gray-600">{text}</p>}
      </div>
    </div>
  );
};
