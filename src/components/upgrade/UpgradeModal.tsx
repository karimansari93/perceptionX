import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, CheckCircle2 } from "lucide-react";

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const UpgradeModal = ({ open, onOpenChange }: UpgradeModalProps) => {
  const handleBookDemo = () => {
    window.open('https://cal.com/karimalansari', '_blank');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-2xl font-bold text-gray-900">Upgrade to Pro</DialogTitle>
            <Badge variant="secondary" className="bg-primary/10 text-primary">Coming Soon</Badge>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Benefits Section */}
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900">What's included:</h3>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-gray-900">Full LLM Coverage</p>
                  <p className="text-sm text-gray-600">Monitor all major LLMs including Claude, Qwen and more</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-gray-900">Employer Branding & Reputation</p>
                  <p className="text-sm text-gray-600">Analyze perception using proprietary our TalentX attributes for themes talent care about most</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-gray-900">Competitor Monitoring</p>
                  <p className="text-sm text-gray-600">Get detailed insights on talent competitors & their AI perception</p>
                </div>
              </div>
            </div>
          </div>

          {/* CTA Section */}
          <div className="bg-primary/10 rounded-lg p-4 space-y-3">
            <p className="text-sm text-gray-600">
              Ready to get started? Book a quick demo call to learn more about our Pro features and pricing.
            </p>
            <Button
              onClick={handleBookDemo}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Calendar className="w-4 h-4 mr-2" />
              Book a Demo
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}; 