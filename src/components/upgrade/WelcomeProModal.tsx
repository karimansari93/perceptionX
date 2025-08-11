import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles, TrendingUp, Users, Database } from 'lucide-react';

interface WelcomeProModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const WelcomeProModal = ({ open, onOpenChange }: WelcomeProModalProps) => {
  const handleGetStarted = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[600px] p-4 sm:p-6">
        <DialogHeader>
          <div className="flex items-center justify-center mb-4">
            <div className="flex items-center gap-3">
              <img
                src="/logos/PerceptionX-PrimaryLogo.png"
                alt="PerceptionX Logo"
                className="h-8"
              />
              <div className="bg-[#0DBCBA] text-white px-3 py-1 rounded-full text-sm font-bold">
                PRO
              </div>
            </div>
          </div>
          <DialogDescription className="text-center text-[#183056] text-base sm:text-lg">
            You now have access to all premium features
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 sm:space-y-6 py-4">
          {/* What's Next Section */}
          <div className="bg-[#EBECED] rounded-lg p-4 sm:p-6">
            <h3 className="font-semibold text-[#13274F] text-base sm:text-lg mb-3 sm:mb-4">What's Next?</h3>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Users className="w-5 h-5 text-[#0DBCBA] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-[#13274F]">Explore Competitors</p>
                  <p className="text-sm text-[#183056]">
                    See how your competitors are perceived and identify opportunities to stand out
                  </p>
                </div>
              </div>
              
              <div className="flex items-start gap-3">
                <Database className="w-5 h-5 text-[#0DBCBA] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-[#13274F]">Review Sources</p>
                  <p className="text-sm text-[#183056]">
                    Understand which data sources influence AI perceptions of your company
                  </p>
                </div>
              </div>
              
              <div className="flex items-start gap-3">
                <TrendingUp className="w-5 h-5 text-[#0DBCBA] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-[#13274F]">Weekly Updates</p>
                  <p className="text-sm text-[#183056]">
                    You'll be notified about new insights and changes in your AI perception every week
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* CTA Section */}
        <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4 pt-4">
          <Button 
            onClick={handleGetStarted}
            className="bg-[#0DBCBA] hover:bg-[#0A9B99] text-white font-semibold px-6 sm:px-8 py-3 text-base sm:text-lg"
          >
            I'm ready
          </Button>
          <Button 
            variant="outline"
            onClick={() => window.open('https://meetings-eu1.hubspot.com/karim-al-ansari', '_blank')}
            className="border-[#0DBCBA] text-[#0DBCBA] hover:bg-[#0DBCBA] hover:text-white font-semibold px-6 sm:px-8 py-3 text-base sm:text-lg"
          >
            Got any questions?
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}; 