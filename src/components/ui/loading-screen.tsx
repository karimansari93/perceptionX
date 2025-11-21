import { cn } from "@/lib/utils";

interface LoadingScreenProps {
  className?: string;
}

export function LoadingScreen({ className }: LoadingScreenProps) {
  return (
    <div className={cn("min-h-screen w-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-white", className)}>
      <div className="text-center space-y-6">
        <div className="relative">
          <img
            src="/logos/PinkBadge.png"
            alt="PerceptionX Logo"
            className="w-32 h-32 rounded-full mx-auto animate-pulse"
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2">
            <div className="h-2 w-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
            <div className="h-2 w-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
            <div className="h-2 w-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
          </div>
          <p className="text-sm text-gray-500 font-medium">Loading...</p>
        </div>
      </div>
    </div>
  );
} 