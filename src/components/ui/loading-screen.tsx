import { cn } from "@/lib/utils";

interface LoadingScreenProps {
  className?: string;
}

export function LoadingScreen({ className }: LoadingScreenProps) {
  return (
    <div className={cn("min-h-screen w-screen flex items-center justify-center bg-gradient-to-br from-[#045962] to-[#019dad]", className)}>
      <div className="text-center">
        <img
          src="/logos/PerceptionX-PrimaryLogo.png"
          alt="PerceptionX Logo"
          className="w-32 h-32 animate-pulse"
        />
      </div>
    </div>
  );
} 