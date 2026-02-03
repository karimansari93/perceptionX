import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import LLMLogo from "@/components/LLMLogo";
import { CheckCircle } from "lucide-react";
import { getLLMDisplayName } from '@/config/llmLogos';
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

// Add shimmer and pulse animation styles
const shimmerStyles = `
  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
  
  @keyframes gradientPulse {
    0%, 100% { 
      background: linear-gradient(90deg, #ec4899, #f97316, #ec4899);
      background-size: 200% 100%;
    }
    50% { 
      background: linear-gradient(90deg, #f97316, #ec4899, #f97316);
      background-size: 200% 100%;
    }
  }
`;

interface ProgressInfo {
  currentModel: string;
  currentPrompt: string;
  completed: number;
  total: number;
}

interface LoadingModalProps {
  isOpen: boolean;
  progress?: ProgressInfo;
  currentModel?: string;
  currentPrompt?: string;
  completed?: number;
  total?: number;
  onClose?: () => void;
  showResultsButton?: boolean;
  isLoadingComplete?: boolean;
}

const llmModels = [
  { name: "OpenAI", model: "openai" },
  { name: "Perplexity", model: "perplexity" },
  { name: "Google AI", model: "google-ai" },
  { name: "DeepSeek", model: "deepseek" },
  { name: "Google AI Overviews", model: "google-ai-overviews" },
];

export const LoadingModal = ({ 
  isOpen, 
  progress,
  currentModel,
  currentPrompt,
  completed,
  total,
  onClose,
  showResultsButton = true,
  isLoadingComplete = false
}: LoadingModalProps) => {
  const [carouselIndex, setCarouselIndex] = useState(0);
  const progressData = progress || { 
    currentModel: currentModel || '', 
    currentPrompt: currentPrompt || '', 
    completed: completed || 0, 
    total: total || 0 
  };
  const progressPercentage = progressData.total > 0 ? (progressData.completed / progressData.total) * 100 : 0;
  const navigate = useNavigate();

  // Check if loading is actually complete (not just initial state)
  const isComplete = isLoadingComplete || (progressData.total > 0 && progressData.completed === progressData.total);

  // Auto-rotate carousel every 3 seconds
  useEffect(() => {
    if (!isOpen) return;
    
    const interval = setInterval(() => {
      setCarouselIndex((prev) => (prev + 1) % llmModels.length);
    }, 3000);

    return () => clearInterval(interval);
  }, [isOpen]);

  return (
    <Dialog open={isOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle className="sr-only">
          {isComplete ? "Results Ready!" : "Getting Your Results"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {isComplete 
            ? "Your AI responses are ready to view"
            : "Testing your prompts across multiple AI models..."}
        </DialogDescription>
        <style>{shimmerStyles}</style> {/* Apply shimmer styles */}
        <div className="text-center space-y-6 py-4">
          {/* Header */}
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-blue-900">
              {isComplete ? "Results Ready!" : "Getting Your Results"}
            </h3>
            <p className="text-sm text-gray-600">
              {isComplete 
                ? "Your AI responses are ready to view"
                : "Testing your prompts across multiple AI models..."}
            </p>
          </div>

          {/* Progress Information */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Responses collected</span>
              <span className="font-medium text-blue-600">
                {progressData.completed} / {progressData.total}
              </span>
            </div>
            <div className="h-3 bg-gray-200 rounded-full overflow-hidden relative">
              {/* Progress bar with pink gradient */}
              <div 
                className="h-full rounded-full transition-all duration-700 ease-out relative"
                style={{ 
                  width: `${progressPercentage}%`,
                  background: 'linear-gradient(90deg, #ec4899, #f97316)',
                  animation: !isComplete ? 'gradientPulse 2s ease-in-out infinite' : 'none'
                }}
              >
                {/* Shimmer overlay for active loading */}
                {!isComplete && (
                  <div 
                    className="absolute inset-0 rounded-full"
                    style={{ 
                      animation: 'shimmer 1.5s infinite',
                      background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)',
                      backgroundSize: '200% 100%'
                    }}
                  />
                )}
              </div>
              
              {/* Subtle glow effect when loading */}
              {!isComplete && progressPercentage > 0 && (
                <div 
                  className="absolute inset-0 rounded-full opacity-50 blur-sm"
                  style={{ 
                    width: `${progressPercentage}%`,
                    background: 'linear-gradient(90deg, #ec4899, #f97316)'
                  }}
                />
              )}
            </div>
            <div className="text-xs text-gray-500">
              {progressData.total > 0 ? `${progressData.total - progressData.completed} responses remaining` : 'Collecting responses...'}
            </div>
          </div>

          {/* All models indicator */}
          <div className="flex justify-center space-x-4">
            {llmModels.map((model, index) => (
              <div key={model.model} className="flex flex-col items-center space-y-1">
                <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center ${
                  carouselIndex === index ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                }`}>
                  <LLMLogo modelName={model.model} size="sm" className="w-4 h-4" />
                </div>
                <div className={`w-2 h-2 rounded-full ${
                  carouselIndex === index ? 'bg-blue-500' : 'bg-gray-300'
                }`}></div>
              </div>
            ))}
          </div>

          {/* Show button when loading is complete */}
          {isComplete && showResultsButton && (
            <Button
              onClick={() => {
                if (onClose) onClose();
                navigate('/dashboard');
              }}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              See my results
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};