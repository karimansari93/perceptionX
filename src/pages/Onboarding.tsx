import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Database } from '@/integrations/supabase/types';
import { PromptsTable } from "@/components/prompts/PromptsTable";
import { ConfirmationCard } from "@/components/prompts/ConfirmationCard";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle, LogOut } from "lucide-react";

// Define the actual database schema we're working with
interface UserOnboarding {
  user_id: string;
  organization_name: string;
  company_name: string;
  industry: string;
  job_function?: string | null;
  country?: string | null;
  session_id: string;
  company_size?: string;
  role?: string;
  goals?: string[];
  competitors?: string[];
}

interface OnboardingData {
  display_name: string;
  organization_name: string;
  company_name: string;
  industry: string;
  job_function: string;
  country: string;
}

interface OnboardingStep {
  title: string;
  description: string;
  fields: Array<{
    label: string;
    type: string;
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
  }>;
  isWelcomeStep?: boolean;
  isPromptsStep?: boolean;
}

export const Onboarding = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [onboardingStep, setOnboardingStep] = useState(0);
  // Total number of steps in the onboarding flow (including the final step on the loading/confirmation page)
  const TOTAL_STEPS = 4;
  const [onboardingData, setOnboardingData] = useState<OnboardingData>({
    display_name: "",
    organization_name: "",
    company_name: "",
    industry: "",
    job_function: "",
    country: "GLOBAL"
  });
  const [onboardingId, setOnboardingId] = useState<string | null>(null);
  const [needsDisplayName, setNeedsDisplayName] = useState(false);

  // Prompts logic
  const [onboardingDataForPrompts, setOnboardingDataForPrompts] = useState<{
    companyName: string;
    industry: string;
    country: string;
  } | null>(null);

  // Local prompts state for display
  const [localPrompts, setLocalPrompts] = useState<Array<{
    id: string;
    text: string;
    category: string;
    type: string;
  }>>([]);

  // State for showing how it works
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  // Check if user needs to provide display name
  useEffect(() => {
    if (user) {
      setNeedsDisplayName(!user.user_metadata?.full_name && !user.user_metadata?.name);
      // Pre-fill display name if available
      const existingName = user.user_metadata?.full_name || user.user_metadata?.name || "";
      setOnboardingData(prev => ({ ...prev, display_name: existingName }));
    }
  }, [user]);

  // Helper function to format prompts with country context
  const getCountryContext = (country: string) => {
    if (!country || country === 'GLOBAL') {
      return '';
    }
    // Map country codes to readable names for better prompt context
    const countryNames: Record<string, string> = {
      'US': ' in the United States',
      'GB': ' in the United Kingdom',
      'CA': ' in Canada',
      'AU': ' in Australia',
      'DE': ' in Germany',
      'FR': ' in France',
      'NL': ' in the Netherlands',
      'SE': ' in Sweden',
      'NO': ' in Norway',
      'DK': ' in Denmark',
      'FI': ' in Finland',
      'CH': ' in Switzerland',
      'AT': ' in Austria',
      'BE': ' in Belgium',
      'IE': ' in Ireland',
      'IT': ' in Italy',
      'ES': ' in Spain',
      'PT': ' in Portugal',
      'PL': ' in Poland',
      'CZ': ' in the Czech Republic',
      'HU': ' in Hungary',
      'SK': ' in Slovakia',
      'SI': ' in Slovenia',
      'HR': ' in Croatia',
      'BG': ' in Bulgaria',
      'RO': ' in Romania',
      'EE': ' in Estonia',
      'LV': ' in Latvia',
      'LT': ' in Lithuania',
      'LU': ' in Luxembourg',
      'MT': ' in Malta',
      'CY': ' in Cyprus',
      'GR': ' in Greece',
      'JP': ' in Japan',
      'KR': ' in South Korea',
      'SG': ' in Singapore',
      'MY': ' in Malaysia',
      'TH': ' in Thailand',
      'PH': ' in the Philippines',
      'ID': ' in Indonesia',
      'IN': ' in India',
      'VN': ' in Vietnam',
      'BR': ' in Brazil',
      'MX': ' in Mexico',
      'AR': ' in Argentina',
      'CL': ' in Chile',
      'CO': ' in Colombia',
      'PE': ' in Peru',
      'ZA': ' in South Africa',
      'AE': ' in the UAE',
      'SA': ' in Saudi Arabia',
      'TR': ' in Turkey',
      'IS': ' in Iceland',
      'NZ': ' in New Zealand'
    };
    return countryNames[country] || ` in ${country}`;
  };

  // Generate prompts when reaching the prompts step or when data changes
  useEffect(() => {
    if (onboardingStep === 3 && onboardingDataForPrompts) {
      const countryContext = getCountryContext(onboardingDataForPrompts.country);
      
      // Generate prompts for display
      const basePrompts = [
        {
          id: 'sentiment-1',
          text: `How is ${onboardingDataForPrompts.companyName} as an employer${countryContext}?`,
          category: 'General',
          type: 'sentiment'
        },
        {
          id: 'visibility-1',
          text: `What is the best company to work for in the ${onboardingDataForPrompts.industry} industry${countryContext}?`,
          category: 'General',
          type: 'visibility'
        },
        {
          id: 'competitive-1',
          text: `How does working at ${onboardingDataForPrompts.companyName} compare to other companies${countryContext}?`,
          category: 'General',
          type: 'competitive'
        }
      ];
      setLocalPrompts(basePrompts);
    }
  }, [onboardingStep, onboardingDataForPrompts]);

  const onboardingSteps: OnboardingStep[] = [
    {
      title: "Welcome to the PerceptionX Beta! 🎉",
      description: "You're joining an exclusive group of early users helping us shape the future of employer perception analysis. Let's get you started!",
      fields: [],
      isWelcomeStep: true
    },
    {
      title: "Your details",
      description: "We'd like to know your name, role, and organization.",
      fields: [
        ...(needsDisplayName ? [{
          label: "Your Name",
          type: "text",
          placeholder: "Enter your full name",
          value: onboardingData.display_name,
          onChange: (value: string) => setOnboardingData(prev => ({ ...prev, display_name: value }))
        }] : []),
        {
          label: "Job Function",
          type: "text",
          placeholder: "e.g., Employer Branding Specialist, Talent Acquisition Manager",
          value: onboardingData.job_function,
          onChange: (value: string) => setOnboardingData(prev => ({ ...prev, job_function: value }))
        },
        {
          label: "Organization Name",
          type: "text",
          placeholder: "e.g., Acme Corp, Your Agency Name",
          value: onboardingData.organization_name,
          onChange: (value: string) => setOnboardingData(prev => ({ ...prev, organization_name: value }))
        }
      ]
    },
    {
      title: "What company do you want to analyze?  ",
      description: "We'll scan AI to uncover what people really think about working there.",
      fields: [
        {
          label: "Company",
          type: "text",
          placeholder: "e.g., Tesla   ",
          value: onboardingData.company_name,
          onChange: (value: string) => setOnboardingData(prev => ({ ...prev, company_name: value }))
        },
        {
          label: "Industry",
          type: "text",
          placeholder: "e.g., Software",
          value: onboardingData.industry,
          onChange: (value: string) => setOnboardingData(prev => ({ ...prev, industry: value }))
        },
        {
          label: "Country",
          type: "select",
          placeholder: "Global (default)",
          value: onboardingData.country,
          onChange: (value: string) => setOnboardingData(prev => ({ ...prev, country: value }))
        }
      ]
    },
    {
      title: "Get your free audit",
      description: "We'll collect data about how your company is perceived by candidates across multiple digital channels. It will include insights such as:",
      fields: [],
      isPromptsStep: true
    }
  ];

  const handleNext = async () => {
    // Skip validation for welcome step
    if (onboardingStep === 0 && onboardingSteps[0].isWelcomeStep) {
      setOnboardingStep(prev => prev + 1);
      return;
    }

    // Step 1: validate user details (name if needed, job function and organization always)
    if (onboardingStep === 1) {
      const requiredFields = needsDisplayName 
        ? [onboardingData.display_name, onboardingData.job_function, onboardingData.organization_name]
        : [onboardingData.job_function, onboardingData.organization_name];
      
      if (requiredFields.some(field => !field.trim())) {
        toast.error('Please fill in all required fields before continuing');
        return;
      }
      
      setOnboardingStep(prev => prev + 1);
      return;
    }

    // Step 2: validate and save company details then proceed to prompts
    if (onboardingStep === 2) {
      const requiredFields = [onboardingData.company_name, onboardingData.industry, onboardingData.country];
      
      if (requiredFields.some(field => !field.trim())) {
        toast.error('Please fill in all required fields before continuing');
        return;
      }

      // Only create new onboarding record if we don't have one
      if (!onboardingId) {
        try {
          // Check if user already has an onboarding record
          const { data: existingOnboarding, error: checkError } = await supabase
            .from('user_onboarding')
            .select('id, company_name, industry')
            .eq('user_id', user?.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          if (checkError && checkError.code !== 'PGRST116') {
            console.error('Error checking existing onboarding:', checkError);
            throw new Error('Failed to check existing onboarding data');
          }

          if (existingOnboarding) {
            // Use existing onboarding record
            setOnboardingId(existingOnboarding.id);
          } else {
            // Create new onboarding record
            const newRecord: UserOnboarding = {
              user_id: user?.id,
              organization_name: onboardingData.organization_name,
              company_name: onboardingData.company_name,
              industry: onboardingData.industry,
              job_function: onboardingData.job_function || null,
              country: onboardingData.country || null,
              session_id: `session_${user?.id}_${Date.now()}`
            } as UserOnboarding;

            const { data, error } = await supabase
              .from('user_onboarding')
              .insert(newRecord)
              .select()
              .single();

            if (error) throw error;

            setOnboardingId(data.id);
          }
        } catch (error) {
          console.error('Error saving onboarding data:', error);
          toast.error('Failed to save onboarding data. Please try again.');
          return;
        }
      }

      // Update user's display name in auth if needed
      if (needsDisplayName && onboardingData.display_name.trim()) {
        const { error: updateError } = await supabase.auth.updateUser({
          data: { full_name: onboardingData.display_name }
        });
        
        if (updateError) {
          console.error('Error updating user display name:', updateError);
          // Don't fail the onboarding if display name update fails
        }
      }
      
      // Set data for prompts step
      setOnboardingDataForPrompts({
        companyName: onboardingData.company_name,
        industry: onboardingData.industry,
        country: onboardingData.country
      });

      // Move to prompts step
      setOnboardingStep(prev => prev + 1);
      return;
    }

    // Handle prompts step completion (now step 3)
    if (onboardingStep === 3) {
      // Navigate to loading page
      navigate('/onboarding/loading', { 
        state: { 
          onboardingId: onboardingId,
          organizationName: onboardingData.organization_name,
          companyName: onboardingData.company_name,
          industry: onboardingData.industry,
          country: onboardingData.country
        }
      });
      return;
    }
  };

  const handleBack = () => {
    // If going back from prompts step, clear the prompts and onboarding data for prompts
    // so they can be regenerated when user returns with potentially updated data
    if (onboardingStep === 3) {
      setLocalPrompts([]);
      setOnboardingDataForPrompts(null);
    }
    setOnboardingStep(prev => prev - 1);
  };

  // Handle keyboard events
  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      // Don't trigger on Enter if user is typing in a textarea
      if (event.target instanceof HTMLTextAreaElement) {
        return;
      }
      handleNext();
    }
  };

  // Handle logout
  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/auth');
    } catch (error) {
      console.error('Error signing out:', error);
      toast.error('Failed to sign out. Please try again.');
    }
  };

  const currentStep = onboardingSteps[onboardingStep];

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-[#fbeef3] flex items-center justify-center p-4 relative" onKeyPress={handleKeyPress}>
        {/* Hide Crisp button on mobile */}
        <style>{`
          @media (max-width: 768px) {
            #crisp-chatbox {
              display: none !important;
            }
          }
        `}</style>
        {/* Top left logo */}
        <div className="absolute top-6 left-6 z-10">
          <a href="https://perceptionx.ai" target="_blank" rel="noopener noreferrer">
            <img src="/logos/PinkBadge.png" alt="PerceptionX" className="h-8 rounded-md shadow-md" />
          </a>
        </div>
        
        {/* Top center progress indicator - hidden on mobile, shown below on mobile */}
        <div className="absolute top-6 left-1/2 transform -translate-x-1/2 z-10 hidden md:block">
          <div className="flex items-center gap-3 bg-white/80 backdrop-blur-sm rounded-full px-4 py-2 shadow-sm border border-white/20">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-[hsl(221,56%,22%)] opacity-70">Step</span>
              <span className="text-sm font-bold text-[hsl(221,56%,22%)]">{onboardingStep + 1}</span>
              <span className="text-xs text-[hsl(221,56%,22%)] opacity-70">of {TOTAL_STEPS}</span>
            </div>
            <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-pink to-pink-500 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${((onboardingStep + 1) / TOTAL_STEPS) * 100}%` }}
              />
            </div>
          </div>
        </div>
        
        {/* Mobile progress indicator - shown below the header row on mobile */}
        <div className="absolute top-20 left-4 right-4 z-10 md:hidden">
          <div className="flex items-center gap-3 bg-white/80 backdrop-blur-sm rounded-full px-4 py-2 shadow-sm border border-white/20 w-full">
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs font-medium text-[hsl(221,56%,22%)] opacity-70">Step</span>
              <span className="text-sm font-bold text-[hsl(221,56%,22%)]">{onboardingStep + 1}</span>
              <span className="text-xs text-[hsl(221,56%,22%)] opacity-70">of {TOTAL_STEPS}</span>
            </div>
            <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-pink to-pink-500 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${((onboardingStep + 1) / TOTAL_STEPS) * 100}%` }}
              />
            </div>
          </div>
        </div>
        
        {/* Top right demo link */}
        <div className="absolute top-6 z-10 right-6 md:right-6 left-1/2 md:left-auto transform md:transform-none -translate-x-1/2 md:translate-x-0">
          <div className="flex items-center gap-2 text-sm text-[hsl(221,56%,22%)] font-medium text-center whitespace-nowrap" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
            <span>Looking to learn more?</span>
            <a 
              href="https://meetings-eu1.hubspot.com/karim-al-ansari" 
              target="_blank" 
              rel="noopener noreferrer"
              className="border-2 border-pink text-pink bg-transparent px-3 py-1 rounded-full hover:bg-pink hover:text-white transition-colors font-bold text-xs"
            >
              Book a demo
            </a>
          </div>
        </div>
        
        {/* Bottom logout button - centered on mobile, left on desktop */}
        <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 md:left-6 md:transform-none z-10">
          <Button
            onClick={handleLogout}
            variant="ghost"
            size="sm"
            className="flex items-center gap-2 text-pink-600 hover:text-pink-800 hover:bg-pink-50 backdrop-blur-sm border border-pink-200/50 bg-white/60 rounded-lg px-3 py-2 shadow-sm transition-all"
          >
            <LogOut className="h-4 w-4" />
            <span className="text-sm hidden md:inline">Sign Out</span>
          </Button>
        </div>
        
        <div className="bg-white rounded-2xl shadow-xl p-4 sm:p-6 md:p-8 max-w-2xl w-full mt-16 md:mt-0">
          <div className="space-y-4">
            {/* Step title and description (except for welcome step) */}
            {!currentStep.isWelcomeStep && (
              <>
                <div className="mb-2">
                  <h1 className="text-xl sm:text-2xl font-semibold text-[hsl(221,56%,22%)]">
                    {currentStep.title}
                  </h1>
                </div>
                <p className="text-sm sm:text-base text-[hsl(221,56%,22%)] mb-4 sm:mb-6">
                  {currentStep.description}
                </p>
              </>
            )}

            {/* Welcome step content */}
            {currentStep.isWelcomeStep ? (
              <div className="text-center space-y-4 sm:space-y-6">
                <div className="w-20 h-20 sm:w-24 sm:h-24 mx-auto">
                  <img 
                    src="/logos/PinkBadge.png" 
                    alt="PerceptionX Logo" 
                    className="w-full h-full object-cover rounded-full"
                  />
                </div>
                <div className="space-y-2 sm:space-y-3">
                  <h1 className="text-2xl sm:text-3xl font-bold text-[hsl(221,56%,22%)]">
                    Welcome to the PerceptionX Beta! 🎉
                  </h1>
                  <p className="text-base sm:text-lg text-[hsl(221,56%,22%)]">
                    You're joining an exclusive group of early users helping us shape the future of employer perception analysis. Let's get you started!
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {currentStep.fields.map((field, index) => (
                  <div key={index} className="space-y-2">
                    <Label className="text-[hsl(221,56%,22%)]">
                      {field.label}
                      {field.label === "Industry" && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="ml-1 inline-block h-4 w-4 text-gray-500" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-sm text-gray-700">
                                We need to know the talent industry you compete in to see how visible you are in candidate searches. This can be updated later.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      {field.label === "Country" && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="ml-1 inline-block h-4 w-4 text-gray-500" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-sm text-gray-700">
                                The default is Global, but we can prompt for a specific country if needed for location-specific insights.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </Label>
                    {field.type === 'select' ? (
                      <div className="relative">
                        <select
                          value={field.value}
                          onChange={(e) => field.onChange(e.target.value)}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-base ring-offset-background appearance-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm hover:border-gray-400 transition-colors"
                        >
                        <option value="">{field.placeholder}</option>
                        {field.label === 'Job Function' ? (
                          <>
                            <option value="hr_generalist">HR Generalist</option>
                            <option value="hr_business_partner">HR Business Partner</option>
                            <option value="talent_acquisition">Talent Acquisition Specialist</option>
                            <option value="talent_acquisition_manager">Talent Acquisition Manager</option>
                            <option value="employer_branding">Employer Branding Specialist</option>
                            <option value="employer_branding_manager">Employer Branding Manager</option>
                            <option value="hr_director">HR Director</option>
                            <option value="talent_director">Talent Director</option>
                            <option value="people_operations">People Operations</option>
                            <option value="recruiting_coordinator">Recruiting Coordinator</option>
                            <option value="hr_analyst">HR Analyst</option>
                            <option value="diversity_inclusion">Diversity & Inclusion Specialist</option>
                            <option value="learning_development">Learning & Development</option>
                            <option value="compensation_benefits">Compensation & Benefits</option>
                            <option value="hr_consultant">HR Consultant</option>
                            <option value="other">Other</option>
                          </>
                        ) : field.label === 'Country' ? (
                          <>
                            <option value="GLOBAL">🌍 Global</option>
                            <option value="AX">🇦🇽 Åland Islands</option>
                            <option value="AD">🇦🇩 Andorra</option>
                            <option value="AI">🇦🇮 Anguilla</option>
                            <option value="AQ">🇦🇶 Antarctica</option>
                            <option value="AG">🇦🇬 Antigua and Barbuda</option>
                            <option value="AR">🇦🇷 Argentina</option>
                            <option value="AW">🇦🇼 Aruba</option>
                            <option value="AU">🇦🇺 Australia</option>
                            <option value="AT">🇦🇹 Austria</option>
                            <option value="BS">🇧🇸 Bahamas</option>
                            <option value="BB">🇧🇧 Barbados</option>
                            <option value="BE">🇧🇪 Belgium</option>
                            <option value="BM">🇧🇲 Bermuda</option>
                            <option value="BV">🇧🇻 Bouvet Island</option>
                            <option value="BR">🇧🇷 Brazil</option>
                            <option value="IO">🇮🇴 British Indian Ocean Territory</option>
                            <option value="VG">🇻🇬 British Virgin Islands</option>
                            <option value="BG">🇧🇬 Bulgaria</option>
                            <option value="CA">🇨🇦 Canada</option>
                            <option value="BQ">🇧🇶 Caribbean Netherlands</option>
                            <option value="KY">🇰🇾 Cayman Islands</option>
                            <option value="CL">🇨🇱 Chile</option>
                            <option value="CO">🇨🇴 Colombia</option>
                            <option value="HR">🇭🇷 Croatia</option>
                            <option value="CU">🇨🇺 Cuba</option>
                            <option value="CW">🇨🇼 Curaçao</option>
                            <option value="CY">🇨🇾 Cyprus</option>
                            <option value="CZ">🇨🇿 Czech Republic</option>
                            <option value="DK">🇩🇰 Denmark</option>
                            <option value="DM">🇩🇲 Dominica</option>
                            <option value="DO">🇩🇴 Dominican Republic</option>
                            <option value="EE">🇪🇪 Estonia</option>
                            <option value="FK">🇫🇰 Falkland Islands</option>
                            <option value="FO">🇫🇴 Faroe Islands</option>
                            <option value="FI">🇫🇮 Finland</option>
                            <option value="FR">🇫🇷 France</option>
                            <option value="GF">🇬🇫 French Guiana</option>
                            <option value="PF">🇵🇫 French Polynesia</option>
                            <option value="DE">🇩🇪 Germany</option>
                            <option value="GI">🇬🇮 Gibraltar</option>
                            <option value="GR">🇬🇷 Greece</option>
                            <option value="GL">🇬🇱 Greenland</option>
                            <option value="GD">🇬🇩 Grenada</option>
                            <option value="GP">🇬🇵 Guadeloupe</option>
                            <option value="HT">🇭🇹 Haiti</option>
                            <option value="HM">🇭🇲 Heard Island and McDonald Islands</option>
                            <option value="HU">🇭🇺 Hungary</option>
                            <option value="IS">🇮🇸 Iceland</option>
                            <option value="IN">🇮🇳 India</option>
                            <option value="ID">🇮🇩 Indonesia</option>
                            <option value="IE">🇮🇪 Ireland</option>
                            <option value="IT">🇮🇹 Italy</option>
                            <option value="JM">🇯🇲 Jamaica</option>
                            <option value="JP">🇯🇵 Japan</option>
                            <option value="LV">🇱🇻 Latvia</option>
                            <option value="LI">🇱🇮 Liechtenstein</option>
                            <option value="LT">🇱🇹 Lithuania</option>
                            <option value="LU">🇱🇺 Luxembourg</option>
                            <option value="MY">🇲🇾 Malaysia</option>
                            <option value="MT">🇲🇹 Malta</option>
                            <option value="MQ">🇲🇶 Martinique</option>
                            <option value="YT">🇾🇹 Mayotte</option>
                            <option value="MX">🇲🇽 Mexico</option>
                            <option value="MC">🇲🇨 Monaco</option>
                            <option value="MS">🇲🇸 Montserrat</option>
                            <option value="NL">🇳🇱 Netherlands</option>
                            <option value="NC">🇳🇨 New Caledonia</option>
                            <option value="NZ">🇳🇿 New Zealand</option>
                            <option value="NO">🇳🇴 Norway</option>
                            <option value="PS">🇵🇸 Palestine</option>
                            <option value="PE">🇵🇪 Peru</option>
                            <option value="PH">🇵🇭 Philippines</option>
                            <option value="PL">🇵🇱 Poland</option>
                            <option value="PT">🇵🇹 Portugal</option>
                            <option value="PR">🇵🇷 Puerto Rico</option>
                            <option value="RE">🇷🇪 Réunion</option>
                            <option value="RO">🇷🇴 Romania</option>
                            <option value="BL">🇧🇱 Saint Barthélemy</option>
                            <option value="KN">🇰🇳 Saint Kitts and Nevis</option>
                            <option value="LC">🇱🇨 Saint Lucia</option>
                            <option value="MF">🇲🇫 Saint Martin</option>
                            <option value="PM">🇵🇲 Saint Pierre and Miquelon</option>
                            <option value="VC">🇻🇨 Saint Vincent and the Grenadines</option>
                            <option value="SM">🇸🇲 San Marino</option>
                            <option value="SA">🇸🇦 Saudi Arabia</option>
                            <option value="SG">🇸🇬 Singapore</option>
                            <option value="SX">🇸🇽 Sint Maarten</option>
                            <option value="SK">🇸🇰 Slovakia</option>
                            <option value="SI">🇸🇮 Slovenia</option>
                            <option value="ZA">🇿🇦 South Africa</option>
                            <option value="GS">🇬🇸 South Georgia and the South Sandwich Islands</option>
                            <option value="KR">🇰🇷 South Korea</option>
                            <option value="ES">🇪🇸 Spain</option>
                            <option value="SJ">🇸🇯 Svalbard and Jan Mayen</option>
                            <option value="SE">🇸🇪 Sweden</option>
                            <option value="CH">🇨🇭 Switzerland</option>
                            <option value="TH">🇹🇭 Thailand</option>
                            <option value="TT">🇹🇹 Trinidad and Tobago</option>
                            <option value="TR">🇹🇷 Turkey</option>
                            <option value="TC">🇹🇨 Turks and Caicos Islands</option>
                            <option value="AE">🇦🇪 United Arab Emirates</option>
                            <option value="GB">🇬🇧 United Kingdom</option>
                            <option value="US">🇺🇸 United States</option>
                            <option value="VA">🇻🇦 Vatican City</option>
                            <option value="VN">🇻🇳 Vietnam</option>
                            <option value="WF">🇼🇫 Wallis and Futuna</option>
                          </>
                        ) : null}
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    ) : field.type === 'textarea' ? (
                      <Textarea
                        placeholder={field.placeholder}
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                        className="min-h-[100px]"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleNext();
                          }
                        }}
                      />
                    ) : (
                      <Input
                        type={field.type}
                        placeholder={field.placeholder}
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleNext();
                          }
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Prompts step content */}
            {currentStep.isPromptsStep && (
              <div className="space-y-6">
                {/* Four individual analysis cards */}
                <div className="grid grid-cols-2 gap-3 md:gap-4">
                  <div className="bg-blue-50 rounded-lg p-3 md:p-4 border border-blue-100">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 md:w-8 md:h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-blue-600 text-xs md:text-sm">🤖</span>
                      </div>
                      <h3 className="font-semibold text-[hsl(221,56%,22%)] text-xs md:text-sm">AI Analysis</h3>
                    </div>
                    <p className="text-[hsl(221,56%,22%)] text-xs leading-relaxed">
                      AI model responses to key questions
                    </p>
                  </div>

                  <div className="bg-green-50 rounded-lg p-3 md:p-4 border border-green-100">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 md:w-8 md:h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-green-600 text-xs md:text-sm">🔍</span>
                      </div>
                      <h3 className="font-semibold text-[hsl(221,56%,22%)] text-xs md:text-sm">Search Insights</h3>
                    </div>
                    <p className="text-[hsl(221,56%,22%)] text-xs leading-relaxed">
                      Search results for career queries
                    </p>
                  </div>

                  <div className="bg-purple-50 rounded-lg p-3 md:p-4 border border-purple-100">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 md:w-8 md:h-8 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-purple-600 text-xs md:text-sm">⚔️</span>
                      </div>
                      <h3 className="font-semibold text-[hsl(221,56%,22%)] text-xs md:text-sm">Competitor Analysis</h3>
                    </div>
                    <p className="text-[hsl(221,56%,22%)] text-xs leading-relaxed">
                      How you compare to competitors
                    </p>
                  </div>

                  <div className="bg-orange-50 rounded-lg p-3 md:p-4 border border-orange-100">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 md:w-8 md:h-8 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-orange-600 text-xs md:text-sm">📊</span>
                      </div>
                      <h3 className="font-semibold text-[hsl(221,56%,22%)] text-xs md:text-sm">Source Mapping</h3>
                    </div>
                    <p className="text-[hsl(221,56%,22%)] text-xs leading-relaxed">
                      Which sources influence perception
                    </p>
                  </div>
                </div>

                {localPrompts.length > 0 ? (
                  <>
                    <div className="flex justify-between items-center">
                      <Button
                        onClick={handleBack}
                        variant="outline"
                        className="text-gray-600"
                      >
                        ← Back
                      </Button>
                      <div className="flex gap-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowHowItWorks(true)}
                          className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 hidden md:block"
                        >
                          How does this work?
                        </Button>
                        
                        <ConfirmationCard 
                          isConfirming={false}
                          onConfirm={() => {
                            // Navigate to loading page instead of starting monitoring
                            navigate('/onboarding/loading', { 
                              state: { 
                                onboardingId: onboardingId,
                                organizationName: onboardingData.organization_name,
                                companyName: onboardingData.company_name,
                                industry: onboardingData.industry,
                                country: onboardingData.country
                              }
                            });
                          }}
                          disabled={false}
                          className="w-auto"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pink-500 mx-auto mb-4"></div>
                    <p className="text-gray-600">Generating your monitoring strategy...</p>
                  </div>
                )}
              </div>
            )}

            {/* Navigation buttons for non-prompts steps */}
            {!currentStep.isPromptsStep && (
              <div className={`flex ${onboardingStep === 0 ? 'justify-center' : 'justify-between'}`}>
                {onboardingStep > 0 && (
                  <Button
                    onClick={handleBack}
                    variant="outline"
                    className="text-gray-600"
                  >
                    ← Back
                  </Button>
                )}
                <Button
                  onClick={handleNext}
                  variant="default"
                  className={`${onboardingStep === 0 ? 'w-full' : 'ml-auto'}`}
                >
                  {onboardingStep === 0 ? 'Get Started' : 'Next'}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* How it works Modal */}
        <Dialog open={showHowItWorks} onOpenChange={setShowHowItWorks}>
          <DialogContent className="max-w-3xl bg-gray-100 sm:top-[50%] sm:translate-y-[-50%] top-auto bottom-0 translate-y-0 rounded-t-xl sm:rounded-lg max-h-[85vh] overflow-y-auto pb-8">
            <DialogTitle className="text-xl font-semibold text-[hsl(221,56%,22%)] mb-6">
              How it works
            </DialogTitle>
            
            {/* Simple Process Description */}
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-[#0DBCBA] rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-bold">1</span>
                </div>
                <h3 className="text-lg font-semibold text-[hsl(221,56%,22%)]">How It Works</h3>
              </div>
              <p className="text-[hsl(221,56%,22%)] leading-relaxed text-base pl-11">
                We ask AI models strategic questions about your company and analyze search results to give you a complete picture of your employer brand perception.
              </p>
            </div>
            
            {/* Sample Questions */}
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-[#0DBCBA] rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-bold">2</span>
                </div>
                <h3 className="text-lg font-semibold text-[hsl(221,56%,22%)]">Sample Questions</h3>
              </div>
              <div className="pl-11">
                <p className="text-[hsl(221,56%,22%)] leading-relaxed text-base mb-4">
                  Here are the types of questions we'll ask AI models about your company:
                </p>
                {localPrompts.length > 0 && (
                  <PromptsTable 
                    prompts={localPrompts.filter(p => p.type !== 'talentx') as any} 
                    companyName={onboardingData.company_name} 
                  />
                )}
              </div>
            </div>
            
            {/* What You Get */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-[#0DBCBA] rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-bold">3</span>
                </div>
                <h3 className="text-lg font-semibold text-[hsl(221,56%,22%)]">What You Get</h3>
              </div>
              <div className="pl-11">
                <p className="text-[hsl(221,56%,22%)] leading-relaxed text-base mb-4">
                  Your <span className="font-semibold text-[#0DBCBA]">free audit</span> includes:
                </p>
                <ul className="space-y-2 text-sm text-[hsl(221,56%,22%)]">
                  <li className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-[#0DBCBA] rounded-full"></div>
                    AI perception analysis across 3 major models
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-[#0DBCBA] rounded-full"></div>
                    Search insights and career visibility analysis
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-[#0DBCBA] rounded-full"></div>
                    Competitor comparison and market positioning
                  </li>
                </ul>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
};