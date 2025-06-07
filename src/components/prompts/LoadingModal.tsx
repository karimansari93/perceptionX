import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import LLMLogo from "@/components/LLMLogo";
import { CheckCircle } from "lucide-react";
import { getLLMDisplayName } from '@/config/llmLogos';
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

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
}

const llmModels = [
  { name: "OpenAI", model: "openai" },
  { name: "Perplexity", model: "perplexity" },
  { name: "Gemini", model: "gemini" },
  { name: "DeepSeek", model: "deepseek" }
];

export const LoadingModal = ({ 
  isOpen, 
  progress,
  currentModel,
  currentPrompt,
  completed,
  total,
  onClose,
  showResultsButton = true
}: LoadingModalProps) => {
  const [carouselIndex, setCarouselIndex] = useState(0);
  const progressData = progress || { currentModel, currentPrompt, completed, total };
  const progressPercentage = progressData.total > 0 ? (progressData.completed / progressData.total) * 100 : 0;
  const navigate = useNavigate();

  // Auto-rotate carousel every 3 seconds
  useEffect(() => {
    if (!isOpen) return;
    
    const interval = setInterval(() => {
      setCarouselIndex((prev) => (prev + 1) % llmModels.length);
    }, 3000);

    return () => clearInterval(interval);
  }, [isOpen]);

  // Show the currently active model in the carousel if available
  const displayModel = progressData.currentModel ? 
    llmModels.find(m => progressData.currentModel.toLowerCase().includes(m.model)) || llmModels[carouselIndex] :
    llmModels[carouselIndex];

  return (
    <Dialog open={isOpen}>
      <DialogContent className="sm:max-w-md">
        <div className="text-center space-y-6 py-4">
          {/* Header */}
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-blue-900">
              {progressData.completed === progressData.total ? "Results Ready!" : "Getting Your Results"}
            </h3>
            <p className="text-sm text-gray-600">
              {progressData.completed === progressData.total 
                ? "Your AI responses are ready to view"
                : "Testing your prompts across multiple AI models..."}
            </p>
          </div>

          {/* Carousel with LLM Logo */}
          <div className="flex justify-center items-center h-24">
            <div 
              key={displayModel.model}
              className="animate-fade-in flex flex-col items-center space-y-2"
            >
              <div className="relative">
                <LLMLogo 
                  modelName={displayModel.model} 
                  size="lg" 
                  className="w-16 h-16 hover:scale-105 transition-transform duration-300" 
                />
                {progressData.currentModel && progressData.currentModel.toLowerCase().includes(displayModel.model) && (
                  <div className="absolute -top-1 -right-1">
                    <div className="w-4 h-4 bg-green-500 rounded-full animate-pulse flex items-center justify-center">
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    </div>
                  </div>
                )}
              </div>
              <span className="text-sm font-medium text-gray-700">
                {displayModel.name}
              </span>
            </div>
          </div>

          {/* Progress Information */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Progress</span>
              <span className="font-medium text-blue-600">
                {progressData.completed} / {progressData.total} complete
              </span>
            </div>
            
            <Progress value={progressPercentage} className="h-2" />
            
            {progressData.currentModel && (
              <div className="text-xs text-gray-500 space-y-1">
                <div>Testing: {getLLMDisplayName(progressData.currentModel)}</div>
                {progressData.currentPrompt && (
                  <div className="truncate max-w-full">
                    Prompt: {progressData.currentPrompt.substring(0, 50)}...
                  </div>
                )}
              </div>
            )}
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
          {progressData.completed === progressData.total && showResultsButton && (
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
