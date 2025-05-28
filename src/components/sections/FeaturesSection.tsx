
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot, BarChart3, Target, Users } from "lucide-react";

const FeaturesSection = () => {
  const features = [
    {
      icon: Bot,
      title: "AI Perception Tracking",
      description: "Monitor how ChatGPT, Claude, and Gemini perceive your employer brand"
    },
    {
      icon: Target,
      title: "Smart Prompt Recommendations",
      description: "Get AI-recommended prompts based on your recruitment strategy"
    },
    {
      icon: BarChart3,
      title: "Real-time Analytics",
      description: "Track visibility scores, citations, and brand mentions across AI models"
    },
    {
      icon: Users,
      title: "Talent Strategy Insights",
      description: "Understand gaps in your employer branding for specific roles"
    }
  ];

  return (
    <section className="container mx-auto px-6 py-16">
      <div className="text-center mb-12">
        <h2 className="text-3xl font-bold text-gray-900 mb-4">
          How it works
        </h2>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Our platform provides comprehensive insights into how AI models understand and represent your employer brand, so you can track control.
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {features.map((feature, index) => (
          <Card key={index} className="border-gray-200 hover:shadow-lg transition-shadow duration-300">
            <CardHeader className="text-center pb-4">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-4">
                <feature.icon className="w-6 h-6 text-primary" />
              </div>
              <CardTitle className="text-lg font-semibold">{feature.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-center text-gray-600">
                {feature.description}
              </CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
};

export default FeaturesSection;
