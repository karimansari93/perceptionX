import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const CTASection = () => {
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
      <div className="rounded-2xl p-12 text-white bg-[#db5f89]">
        <h2 className="text-3xl font-bold mb-4">
          Ready to Understand Your AI Perception?
        </h2>
        <p className="text-xl mb-8 text-primary-foreground/80 max-w-2xl mx-auto">
          {user ? 'Continue monitoring your AI perception with personalized insights.' : 'Start with our intelligent onboarding to get personalized prompt recommendations for your recruitment strategy.'}
        </p>
        <Button size="lg" onClick={handleGetStarted} className="bg-white text-primary hover:bg-gray-100 text-lg px-8 py-6">
          {user ? 'View Dashboard' : 'Begin Your Analysis'}
          <ArrowRight className="ml-2 w-5 h-5" />
        </Button>
      </div>
    </section>
  );
};

export default CTASection;
