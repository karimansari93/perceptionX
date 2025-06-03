import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import LLMLogo from "@/components/LLMLogo";
import { CheckCircle } from "lucide-react";
import { getLLMDisplayName } from '@/config/llmLogos';

interface LoadingModalProps {
  isOpen: boolean;
  currentModel?: string;
  currentPrompt?: string;
  completed: number;
  total: number;
}

const llmModels = [
  { name: "OpenAI", model: "openai" },
  { name: "Perplexity", model: "perplexity" },
  { name: "Gemini", model: "gemini" },
  { name: "DeepSeek", model: "deepseek" }
];

export const LoadingModal = ({ 
  isOpen, 
  currentModel, 
  currentPrompt, 
  completed, 
  total 
}: LoadingModalProps) => {
  const [carouselIndex, setCarouselIndex] = useState(0);
  const progressPercentage = total > 0 ? (completed / total) * 100 : 0;

  // Auto-rotate carousel every 3 seconds
  useEffect(() => {
    if (!isOpen) return;
    
    const interval = setInterval(() => {
      setCarouselIndex((prev) => (prev + 1) % llmModels.length);
    }, 3000);

    return () => clearInterval(interval);
  }, [isOpen]);

  // Show the currently active model in the carousel if available
  const displayModel = currentModel ? 
    llmModels.find(m => currentModel.toLowerCase().includes(m.model)) || llmModels[carouselIndex] :
    llmModels[carouselIndex];

  return (
    <Dialog open={isOpen}>
      <DialogContent className="sm:max-w-md">
        <div className="text-center space-y-6 py-4">
          {/* Header */}
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-blue-900">
              Getting Your Results
            </h3>
            <p className="text-sm text-gray-600">
              Testing your prompts across multiple AI models...
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
                {currentModel && currentModel.toLowerCase().includes(displayModel.model) && (
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
                {completed} / {total} complete
              </span>
            </div>
            
            <Progress value={progressPercentage} className="h-2" />
            
            {currentModel && (
              <div className="text-xs text-gray-500 space-y-1">
                <div>Testing: {getLLMDisplayName(currentModel)}</div>
                {currentPrompt && (
                  <div className="truncate max-w-full">
                    Prompt: {currentPrompt.substring(0, 50)}...
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
        </div>
      </DialogContent>
    </Dialog>
  );
};
