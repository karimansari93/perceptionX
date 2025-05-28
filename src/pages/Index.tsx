
import { useAuth } from "@/contexts/AuthContext";
import Header from "@/components/layout/Header";
import HeroSection from "@/components/sections/HeroSection";
import LLMModelsSection from "@/components/sections/LLMModelsSection";
import FeaturesSection from "@/components/sections/FeaturesSection";
import SearchVolumeShiftSection from "@/components/sections/SearchVolumeShiftSection";
import UseCasesSection from "@/components/sections/UseCasesSection";
import CTASection from "@/components/sections/CTASection";

const Index = () => {
  const { loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <Header />
      <HeroSection />
      <LLMModelsSection />
      <FeaturesSection />
      <SearchVolumeShiftSection />
      <UseCasesSection />
      <CTASection />
    </div>
  );
};

export default Index;
