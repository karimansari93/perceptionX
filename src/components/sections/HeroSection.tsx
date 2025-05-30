import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const HeroSection = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const handleGetStarted = () => {
    if (user) {
      navigate('/dashboard', { 
        state: { 
          showOnboarding: true 
        },
        replace: true 
      });
    } else {
      navigate('/auth');
    }
  };

  return (
    <section className="container mx-auto px-6 py-20 text-center">
      <h1 className="text-5xl font-bold text-gray-900 mb-6 leading-tight">
        Understand Your Employer Brand's
        <span className="text-primary block">AI Perception</span>
      </h1>
      
      <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto leading-relaxed">
        Track how leading AI models like ChatGPT, Claude, and Gemini perceive your company. 
        Get data-driven insights to improve your talent acquisition strategy and employer branding.
      </p>
      
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <Button size="lg" onClick={handleGetStarted} className="bg-primary hover:bg-primary/90 text-lg px-8 py-6">
          {user ? 'Go to Dashboard' : 'Start Free Analysis'}
          <ArrowRight className="ml-2 w-5 h-5" />
        </Button>
        {!user && (
          <Button size="lg" variant="outline" onClick={() => navigate('/auth')} className="text-lg px-8 py-6 border-gray-300 hover:border-primary/30">
            Sign In
          </Button>
        )}
      </div>
    </section>
  );
};

export default HeroSection;
