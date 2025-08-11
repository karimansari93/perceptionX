import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, CheckCircle2, CreditCard, Loader2 } from "lucide-react";
import { useState } from "react";
import { StripeService } from "@/services/stripe";

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const UpgradeModal = ({ open, onOpenChange }: UpgradeModalProps) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Replace this with your actual Stripe Price ID
  const PRO_PRICE_ID = 'price_1RtPMbKHaELhU81I97BZcvpg';

  const handleUpgrade = async () => {
    setLoading(true);
    setError(null);

    try {
      await StripeService.redirectToCheckout(
        PRO_PRICE_ID,
        `${window.location.origin}/dashboard?upgrade=success`,
        `${window.location.origin}/dashboard?upgrade=cancelled`
      );
    } catch (err) {
      console.error('Upgrade error:', err);
      setError('Failed to start checkout. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleBookDemo = () => {
    window.open('https://meetings-eu1.hubspot.com/karim-al-ansari', '_blank');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-2xl font-bold text-[#13274F]">PerceptionX Pro</DialogTitle>
            <Badge variant="secondary" className="bg-[#DB5E89] text-white font-semibold">Limited Time</Badge>
          </div>
          <DialogDescription className="text-[#183056] opacity-80">
            Unlock advanced competitor analysis, comprehensive AI coverage, and weekly insights
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Benefits Section */}
          <div className="space-y-4">
            <h3 className="font-semibold text-[#13274F]">What's included:</h3>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#0DBCBA] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-[#13274F]">Competitor & Source Breakdowns</p>
                  <p className="text-sm text-[#183056]">
                    Detailed analysis of your competitors' talent attraction strategies and comprehensive analysis of data sources and their impact on talent perception
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#0DBCBA] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-[#13274F]">Full AI Coverage</p>
                  <p className="text-sm text-[#183056]">
                    Access to all AI models for comprehensive employer reputation analysis
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#0DBCBA] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-[#13274F]">Weekly Data Updates & Notifications</p>
                  <p className="text-sm text-[#183056]">
                    Stay informed with regular updates and automated notifications about new insights
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#0DBCBA] mt-0.5 flex-shrink-0" />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-[#13274F]">All TalentX Pro Prompts</p>
                    <Badge variant="secondary" className="bg-[#183056] text-white text-xs px-2 py-0.5">Coming Soon</Badge>
                  </div>
                  <p className="text-sm text-[#183056]">
                    Access to 30 specialized prompts for comprehensive talent attraction analysis across 10 key attributes
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* CTA Section */}
          <div className="bg-[#EBECED] rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-[#13274F]">Pro Plan - Beta Pricing</p>
                <div className="flex items-center gap-2">
                  <p className="text-sm text-[#183056] line-through">$199/month</p>
                  <p className="text-lg font-bold text-[#0DBCBA]">$99/month</p>
                  <Badge variant="secondary" className="bg-[#DB5E89] text-white text-xs">50% OFF</Badge>
                </div>
                <p className="text-xs text-[#DB5E89] font-medium mt-1">⚡ Limited time beta pricing</p>
              </div>
            </div>
            
            <div className="space-y-2">
              {/* Stripe button temporarily hidden - can be re-enabled later */}
              {/* <Button
                onClick={handleUpgrade}
                disabled={loading}
                className="w-full bg-[#DB5E89] text-white hover:bg-[#C54A7A] font-semibold"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4 mr-2" />
                    Get Early Access Now
                  </>
                )}
              </Button> */}
              
              <Button
                onClick={handleBookDemo}
                variant="outline"
                className="w-full border-[#0DBCBA] text-[#0DBCBA] hover:bg-[#0DBCBA] hover:text-white"
              >
                <Calendar className="w-4 h-4 mr-2" />
                Book a Demo
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}; 