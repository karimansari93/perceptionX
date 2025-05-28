
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, YAxis, ResponsiveContainer, Cell } from "recharts";
import LLMLogo from "@/components/LLMLogo";

const SearchVolumeShiftSection = () => {
  const llmData = [{
    name: "OpenAI",
    model: "gpt-4",
    value: 85,
    color: "#10B981"
  }, {
    name: "Perplexity",
    model: "perplexity",
    value: 78,
    color: "#06B6D4"
  }, {
    name: "Claude",
    model: "claude-3",
    value: 72,
    color: "#F59E0B"
  }, {
    name: "Gemini",
    model: "gemini",
    value: 68,
    color: "#3B82F6"
  }, {
    name: "DeepSeek",
    model: "deepseek",
    value: 45,
    color: "#8B5CF6"
  }, {
    name: "Meta",
    model: "meta",
    value: 38,
    color: "#EF4444"
  }, {
    name: "Mistral",
    model: "grok",
    value: 25,
    color: "#F97316"
  }];

  const chartConfig = {
    value: {
      label: "AI Usage %",
      color: "hsl(var(--primary))"
    }
  };

  const CustomYAxisTick = (props: any) => {
    const { payload, x, y } = props;
    if (!payload) return null;
    
    const modelData = llmData.find(item => item.name === payload.value);
    if (!modelData) return null;

    return (
      <g transform={`translate(${x},${y})`}>
        <foreignObject x={-30} y={-12} width={24} height={24}>
          <LLMLogo modelName={modelData.model} size="md" className="w-6 h-6" />
        </foreignObject>
      </g>
    );
  };

  return (
    <section className="container mx-auto px-6 py-16">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div className="space-y-6">
          <h2 className="text-4xl font-bold text-gray-900 leading-tight">
            Talent are shifting from{" "}
            <span className="text-gray-500">review sites and forums</span> to{" "}
            <span className="text-primary">AI</span>
          </h2>
          
          <div className="space-y-4">
            <p className="text-lg text-gray-600 leading-relaxed">As talent migrates from traditional review sites and online forums to AI-powered platforms, employer discovery patterns are fundamentally changing. All major AI models are capturing career research volume — creating new channels for how candidates find and evaluate potential employers.</p>
            
            <p className="text-lg text-gray-600 leading-relaxed">Tracking this shift helps you understand where top talent is discovering companies and how to optimize your employer presence across AI platforms to get found by the right candidates.</p>
          </div>
        </div>
        
        <div className="flex justify-center lg:justify-end">
          <div className="w-full max-w-md">
            <ChartContainer config={chartConfig} className="h-[400px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart 
                  data={llmData} 
                  layout="horizontal"
                  margin={{
                    top: 20,
                    right: 30,
                    left: 40,
                    bottom: 20
                  }}
                >
                  <YAxis 
                    dataKey="name" 
                    type="category" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={<CustomYAxisTick />}
                    width={40}
                  />
                  <ChartTooltip 
                    content={<ChartTooltipContent />} 
                    cursor={{ fill: 'rgba(0, 0, 0, 0.1)' }} 
                  />
                  <Bar 
                    dataKey="value" 
                    radius={[0, 4, 4, 0]}
                  >
                    {llmData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </div>
        </div>
      </div>
    </section>
  );
};

export default SearchVolumeShiftSection;
