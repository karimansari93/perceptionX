
import LLMLogo from "@/components/LLMLogo";

const LLMModelsSection = () => {
  const llmModels = [{
    name: "OpenAI",
    model: "gpt-4"
  }, {
    name: "Claude",
    model: "claude-3"
  }, {
    name: "Gemini",
    model: "gemini"
  }, {
    name: "DeepSeek",
    model: "deepseek"
  }, {
    name: "Perplexity",
    model: "perplexity"
  }, {
    name: "Grok",
    model: "grok"
  }];

  return (
    <section className="bg-white/50 py-12 border-y border-gray-100">
      <div className="container mx-auto px-6">
        <div className="text-center mb-8">
          <p className="text-sm font-medium text-gray-600 uppercase tracking-wide">
            Trusted AI Models We Monitor
          </p>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8 items-center justify-items-center">
          {llmModels.map((llm, index) => (
            <div key={index} className="flex flex-col items-center space-y-2 hover:opacity-80 transition-opacity duration-300">
              <div className="w-50 h-50 flex items-center justify-center">
                <LLMLogo modelName={llm.model} size="lg" className="hover:scale-105 transition-all duration-300 w-20 h-20" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default LLMModelsSection;
