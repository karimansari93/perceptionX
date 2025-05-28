import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Bot, Send, ArrowRight, CheckCircle, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import UserMenu from "@/components/UserMenu";

interface Message {
  id: string;
  type: 'bot' | 'user';
  content: string;
  timestamp: Date;
}

interface OnboardingData {
  companyName: string;
  industry: string;
  hiringChallenges: string[];
  targetRoles: string[];
  currentStrategy: string;
  talentCompetitors: string[];
}

const Onboarding = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentInput, setCurrentInput] = useState("");
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingData, setOnboardingData] = useState<OnboardingData>({
    companyName: "",
    industry: "",
    hiringChallenges: [],
    targetRoles: [],
    currentStrategy: "",
    talentCompetitors: []
  });
  const [isLoading, setIsLoading] = useState(true);
  const [onboardingId, setOnboardingId] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState(false);

  const onboardingQuestions = [
    "What's your company name?",
    "What industry are you in? (e.g., Oil & Gas, Tech, Finance, Healthcare)",
    "What are your main hiring challenges? (e.g., attracting tech talent, diversity hiring, employer branding)",
    "What types of roles are you primarily recruiting for?",
    "Who are your main talent competitors? (companies you compete with for the same talent)",
    "Briefly describe your current recruitment strategy or what you're trying to improve."
  ];

  // Load existing onboarding data and resume from correct step
  useEffect(() => {
    const loadOnboardingProgress = async () => {
      setIsLoading(true);
      setConnectionError(false);
      
      try {
        // Test connection first
        const { error: connectionTest } = await supabase
          .from('user_onboarding')
          .select('id')
          .limit(1);

        if (connectionTest) {
          console.error('Connection test failed:', connectionTest);
          setConnectionError(true);
          setIsLoading(false);
          // Start with fresh onboarding if connection fails
          setMessages([
            {
              id: '1',
              type: 'bot',
              content: "Hello! I'm your AI recruitment strategy assistant. I'll help you understand how AI models perceive your employer brand and recommend the best prompts to track. Let's start with your company name.",
              timestamp: new Date()
            }
          ]);
          return;
        }

        // Try to find existing onboarding record for this user
        let onboardingRecord = null;
        
        if (user) {
          console.log('Loading onboarding progress for user:', user.id);
          const { data: userRecord, error: userError } = await supabase
            .from('user_onboarding')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1);

          if (userError) {
            console.error('Error loading user onboarding:', userError);
          } else if (userRecord && userRecord.length > 0) {
            onboardingRecord = userRecord[0];
            console.log('Found existing user onboarding record:', onboardingRecord);
          }
        }

        // If no user record found, check for session-based record
        if (!onboardingRecord) {
          const sessionId = localStorage.getItem('onboarding_session_id');
          if (sessionId) {
            console.log('Checking for session-based onboarding:', sessionId);
            const { data: sessionRecord, error: sessionError } = await supabase
              .from('user_onboarding')
              .select('*')
              .eq('session_id', sessionId)
              .limit(1);

            if (sessionError) {
              console.error('Error loading session onboarding:', sessionError);
            } else if (sessionRecord && sessionRecord.length > 0) {
              onboardingRecord = sessionRecord[0];
              console.log('Found existing session onboarding record:', onboardingRecord);
            }
          }
        }

        if (onboardingRecord) {
          // Resume from existing data
          setOnboardingId(onboardingRecord.id);
          const data = {
            companyName: onboardingRecord.company_name || "",
            industry: onboardingRecord.industry || "",
            hiringChallenges: onboardingRecord.hiring_challenges || [],
            targetRoles: onboardingRecord.target_roles || [],
            currentStrategy: onboardingRecord.current_strategy || "",
            talentCompetitors: onboardingRecord.talent_competitors || []
          };
          setOnboardingData(data);

          // Determine what step we should be on based on completed data
          let stepToResume = 0;
          if (data.companyName) stepToResume = 1;
          if (data.industry) stepToResume = 2;
          if (data.hiringChallenges.length > 0) stepToResume = 3;
          if (data.targetRoles.length > 0) stepToResume = 4;
          if (data.talentCompetitors.length > 0) stepToResume = 5;
          if (data.currentStrategy) stepToResume = 6;

          setOnboardingStep(stepToResume);

          // Rebuild conversation history
          const conversationMessages: Message[] = [
            {
              id: '1',
              type: 'bot',
              content: "Hello! I'm your AI recruitment strategy assistant. I'll help you understand how AI models perceive your employer brand and recommend the best prompts to track. Let's start with your company name.",
              timestamp: new Date()
            }
          ];

          // Add completed Q&A pairs
          if (data.companyName) {
            conversationMessages.push(
              {
                id: `user-0`,
                type: 'user',
                content: data.companyName,
                timestamp: new Date()
              },
              {
                id: `bot-0`,
                type: 'bot',
                content: stepToResume < 6 ? `Great! ${onboardingQuestions[1]}` : "Perfect! Based on your responses, I've identified some key prompts to track your AI perception. Let me generate your personalized monitoring strategy...",
                timestamp: new Date()
              }
            );
          }

          if (data.industry) {
            conversationMessages.push(
              {
                id: `user-1`,
                type: 'user',
                content: data.industry,
                timestamp: new Date()
              },
              {
                id: `bot-1`,
                type: 'bot',
                content: stepToResume < 6 ? `Great! ${onboardingQuestions[2]}` : "Perfect! Based on your responses, I've identified some key prompts to track your AI perception. Let me generate your personalized monitoring strategy...",
                timestamp: new Date()
              }
            );
          }

          if (data.hiringChallenges.length > 0) {
            conversationMessages.push(
              {
                id: `user-2`,
                type: 'user',
                content: data.hiringChallenges.join(', '),
                timestamp: new Date()
              },
              {
                id: `bot-2`,
                type: 'bot',
                content: stepToResume < 6 ? `Great! ${onboardingQuestions[3]}` : "Perfect! Based on your responses, I've identified some key prompts to track your AI perception. Let me generate your personalized monitoring strategy...",
                timestamp: new Date()
              }
            );
          }

          if (data.targetRoles.length > 0) {
            conversationMessages.push(
              {
                id: `user-3`,
                type: 'user',
                content: data.targetRoles.join(', '),
                timestamp: new Date()
              },
              {
                id: `bot-3`,
                type: 'bot',
                content: stepToResume < 6 ? `Great! ${onboardingQuestions[4]}` : "Perfect! Based on your responses, I've identified some key prompts to track your AI perception. Let me generate your personalized monitoring strategy...",
                timestamp: new Date()
              }
            );
          }

          if (data.talentCompetitors.length > 0) {
            conversationMessages.push(
              {
                id: `user-4`,
                type: 'user',
                content: data.talentCompetitors.join(', '),
                timestamp: new Date()
              },
              {
                id: `bot-4`,
                type: 'bot',
                content: stepToResume < 6 ? `Great! ${onboardingQuestions[5]}` : "Perfect! Based on your responses, I've identified some key prompts to track your AI perception. Let me generate your personalized monitoring strategy...",
                timestamp: new Date()
              }
            );
          }

          if (data.currentStrategy) {
            conversationMessages.push(
              {
                id: `user-5`,
                type: 'user',
                content: data.currentStrategy,
                timestamp: new Date()
              },
              {
                id: `bot-5`,
                type: 'bot',
                content: "Perfect! Based on your responses, I've identified some key prompts to track your AI perception. Let me generate your personalized monitoring strategy...",
                timestamp: new Date()
              }
            );

            // Add completion message if fully complete
            if (stepToResume >= 6) {
              setTimeout(() => {
                conversationMessages.push({
                  id: 'completion',
                  type: 'bot',
                  content: `🎉 Your data is ready for analysis! I'll now process your information through our AI network to generate personalized prompts. Click below to continue.`,
                  timestamp: new Date()
                });
                setMessages([...conversationMessages]);
              }, 1000);
            }
          }

          setMessages(conversationMessages);

          if (stepToResume < 6) {
            // Show next question
            setTimeout(() => {
              const nextMessage: Message = {
                id: `bot-next`,
                type: 'bot',
                content: onboardingQuestions[stepToResume],
                timestamp: new Date()
              };
              setMessages(prev => [...prev, nextMessage]);
            }, 500);
          }

          console.log('Resumed onboarding at step:', stepToResume);
        } else {
          // Start fresh onboarding
          console.log('Starting fresh onboarding');
          setMessages([
            {
              id: '1',
              type: 'bot',
              content: "Hello! I'm your AI recruitment strategy assistant. I'll help you understand how AI models perceive your employer brand and recommend the best prompts to track. Let's start with your company name.",
              timestamp: new Date()
            }
          ]);
        }
      } catch (error) {
        console.error('Error loading onboarding progress:', error);
        setConnectionError(true);
        toast.error('Failed to load onboarding progress');
        // Start fresh on error
        setMessages([
          {
            id: '1',
            type: 'bot',
            content: "Hello! I'm your AI recruitment strategy assistant. I'll help you understand how AI models perceive your employer brand and recommend the best prompts to track. Let's start with your company name.",
            timestamp: new Date()
          }
        ]);
      } finally {
        setIsLoading(false);
      }
    };

    loadOnboardingProgress();
  }, [user]);

  const saveOnboardingProgress = async (updatedData: OnboardingData, step: number) => {
    // Skip saving if there's a connection error
    if (connectionError) {
      console.log('Skipping save due to connection error');
      return;
    }

    try {
      const sessionId = localStorage.getItem('onboarding_session_id') || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('onboarding_session_id', sessionId);

      const record = {
        company_name: updatedData.companyName,
        industry: updatedData.industry,
        hiring_challenges: updatedData.hiringChallenges,
        target_roles: updatedData.targetRoles,
        current_strategy: updatedData.currentStrategy,
        talent_competitors: updatedData.talentCompetitors,
        session_id: sessionId,
        user_id: user?.id || null
      };

      if (onboardingId) {
        // Update existing record
        const { error } = await supabase
          .from('user_onboarding')
          .update(record)
          .eq('id', onboardingId);

        if (error) {
          console.error('Error updating onboarding:', error);
          setConnectionError(true);
        } else {
          console.log('Onboarding progress saved');
        }
      } else {
        // Create new record
        const { data, error } = await supabase
          .from('user_onboarding')
          .insert(record)
          .select()
          .single();

        if (error) {
          console.error('Error creating onboarding:', error);
          setConnectionError(true);
        } else {
          setOnboardingId(data.id);
          console.log('New onboarding record created:', data.id);
        }
      }
    } catch (error) {
      console.error('Error saving onboarding progress:', error);
      setConnectionError(true);
    }
  };

  const handleSendMessage = async () => {
    if (!currentInput.trim()) return;

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: currentInput,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);

    // Update onboarding data based on step
    const newData = { ...onboardingData };
    switch (onboardingStep) {
      case 0:
        newData.companyName = currentInput;
        break;
      case 1:
        newData.industry = currentInput;
        break;
      case 2:
        newData.hiringChallenges = currentInput.split(',').map(item => item.trim());
        break;
      case 3:
        newData.targetRoles = currentInput.split(',').map(item => item.trim());
        break;
      case 4:
        newData.talentCompetitors = currentInput.split(',').map(item => item.trim());
        break;
      case 5:
        newData.currentStrategy = currentInput;
        break;
    }
    setOnboardingData(newData);

    const nextStep = onboardingStep + 1;

    // Save progress after each step
    await saveOnboardingProgress(newData, nextStep);

    // Generate bot response
    setTimeout(() => {
      let botResponse = "";

      if (nextStep < onboardingQuestions.length) {
        botResponse = `Great! ${onboardingQuestions[nextStep]}`;
      } else {
        botResponse = `Perfect! Based on your responses, I've identified some key prompts to track your AI perception. Let me generate your personalized monitoring strategy...`;
      }

      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'bot',
        content: botResponse,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, botMessage]);
      
      if (nextStep >= onboardingQuestions.length) {
        // Show completion after a delay
        setTimeout(() => {
          const completionMessage: Message = {
            id: (Date.now() + 2).toString(),
            type: 'bot',
            content: `🎉 Your data is ready for analysis! I'll now process your information through our AI network to generate personalized prompts. Click below to continue.`,
            timestamp: new Date()
          };
          setMessages(prev => [...prev, completionMessage]);
        }, 2000);
      }
      
      setOnboardingStep(nextStep);
    }, 1000);

    setCurrentInput("");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSendMessage();
    }
  };

  const progress = Math.min((onboardingStep / onboardingQuestions.length) * 100, 100);
  const isComplete = onboardingStep >= onboardingQuestions.length;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{background: 'linear-gradient(to bottom right, #045962, #019dad)'}}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-white">Loading your onboarding progress...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{background: 'linear-gradient(to bottom right, #045962, #019dad)'}}>
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <Button 
            variant="ghost" 
            onClick={() => navigate('/')}
            className="flex items-center"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
          <div className="flex items-center space-x-4">
            <Progress value={progress} className="w-32" />
            <span className="text-sm text-gray-600">{Math.round(progress)}% Complete</span>
          </div>
          {user ? <UserMenu /> : (
            <Button 
              onClick={() => navigate('/auth')}
              variant="outline"
              size="sm"
            >
              Sign In
            </Button>
          )}
        </div>
      </header>

      <div className="container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto">
          {connectionError && (
            <Card className="mb-6 bg-yellow-50 border-yellow-200">
              <CardContent className="p-4">
                <div className="flex items-center space-x-2 text-yellow-800">
                  <AlertCircle className="w-5 h-5" />
                  <span className="font-medium">Connection Issue</span>
                </div>
                <p className="text-yellow-700 mt-1">
                  Unable to save progress to database. You can continue with onboarding, but your progress won't be saved until the connection is restored.
                </p>
              </CardContent>
            </Card>
          )}

          <Card className="bg-white shadow-lg">
            <CardHeader className="border-b bg-gradient-to-r from-blue-50 to-indigo-50">
              <CardTitle className="flex items-center">
                <div className="w-6 h-6 mr-2 rounded-full overflow-hidden flex-shrink-0">
                  <img 
                    src="/lovable-uploads/4e28aa28-e0f0-4c44-ba78-9965207a284e.png" 
                    alt="PerceptionX Logo" 
                    className="w-full h-full object-cover"
                  />
                </div>
                PerceptionX LLM Assistant
              </CardTitle>
            </CardHeader>
            
            <CardContent className="p-0">
              {/* Chat Messages */}
              <div className="h-96 overflow-y-auto p-6 space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                        message.type === 'user'
                          ? 'text-white'
                          : 'bg-gray-100 text-gray-900'
                      }`}
                      style={message.type === 'user' ? { backgroundColor: '#db5f89' } : {}}
                    >
                      <p className="text-sm">{message.content}</p>
                      <span className="text-xs opacity-70 mt-1 block">
                        {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Input Area */}
              <div className="border-t bg-gray-50 p-4">
                {!isComplete ? (
                  <div className="flex space-x-2">
                    <Input
                      value={currentInput}
                      onChange={(e) => setCurrentInput(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="Type your response..."
                      className="flex-1"
                    />
                    <Button 
                      onClick={handleSendMessage}
                      disabled={!currentInput.trim()}
                      size="sm"
                      style={{ backgroundColor: '#db5f89' }}
                      className="hover:opacity-90 text-white"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="text-center space-y-4">
                    <div className="flex items-center justify-center space-x-2 text-green-600">
                      <CheckCircle className="w-5 h-5" />
                      <span className="font-medium">Onboarding Complete!</span>
                    </div>
                    <Button 
                      onClick={() => navigate('/analysis', { 
                        state: { 
                          onboardingData
                        } 
                      })}
                      style={{ backgroundColor: '#db5f89' }}
                      className="hover:opacity-90 text-white"
                    >
                      Start AI Analysis
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Progress Summary */}
          {onboardingStep > 0 && (
            <Card className="mt-6 bg-blue-50 border-blue-200">
              <CardContent className="p-4">
                <h3 className="font-medium text-blue-900 mb-2">Your Information So Far:</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                  {onboardingData.companyName && (
                    <div>
                      <Badge variant="secondary" className="mr-2">Company:</Badge>
                      {onboardingData.companyName}
                    </div>
                  )}
                  {onboardingData.industry && (
                    <div>
                      <Badge variant="secondary" className="mr-2">Industry:</Badge>
                      {onboardingData.industry}
                    </div>
                  )}
                  {onboardingData.hiringChallenges.length > 0 && (
                    <div className="md:col-span-2">
                      <Badge variant="secondary" className="mr-2">Challenges:</Badge>
                      {onboardingData.hiringChallenges.join(', ')}
                    </div>
                  )}
                  {onboardingData.talentCompetitors.length > 0 && (
                    <div className="md:col-span-2">
                      <Badge variant="secondary" className="mr-2">Talent Competitors:</Badge>
                      {onboardingData.talentCompetitors.join(', ')}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
