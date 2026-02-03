import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PricingTier {
  name: string;
  price: string;
  priceUnit: string;
  description: string;
  features: string[];
  buttonText: string;
  buttonVariant: "default" | "outline" | "secondary";
  popular?: boolean;
  action: () => void;
  disabled?: boolean;
}

export const UpgradeModal = ({ open, onOpenChange }: UpgradeModalProps) => {
  const handleContactSales = () => {
    window.open('https://meetings-eu1.hubspot.com/karim-al-ansari', '_blank');
  };

  const pricingTiers: PricingTier[] = [
    {
      name: "Free",
      price: "$0",
      priceUnit: "/month",
      description: "You're here — great start!",
      features: [
        "Basic company insights",
        "5 prompts per month",
        "Up to 3 companies",
        "Dashboard access",
        "Basic analytics"
      ],
      buttonText: "Current Plan",
      buttonVariant: "outline",
      action: () => {},
      disabled: true
    },
    {
      name: "Pro",
      price: "Custom",
      priceUnit: "",
      description: "More companies, more insights, more results",
      features: [
        "Full company insights",
        "Unlimited companies",
        "Monthly data updates",
        "Company reports & analytics",
        "All AI models",
        "Priority support"
      ],
      buttonText: "Contact Sales",
      buttonVariant: "default",
      popular: true,
      action: handleContactSales
    },
    {
      name: "Enterprise",
      price: "Custom",
      priceUnit: "",
      description: "Built for teams that scale",
      features: [
        "Everything in Pro",
        "Unlimited users",
        "Unlimited companies",
        "Priority support",
        "Regular strategy calls",
        "Custom reporting",
        "Dedicated success manager"
      ],
      buttonText: "Chat with us",
      buttonVariant: "outline",
      action: handleContactSales
    }
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[95vh] overflow-y-auto mx-2 sm:mx-0">
        <DialogHeader className="px-4 sm:px-6">
          <div className="text-center">
            <DialogTitle className="text-2xl sm:text-3xl font-bold text-[#13274F] mb-3 font-geologica">
              Upgrade Your Plan
            </DialogTitle>
            <p className="text-gray-600 text-base sm:text-lg px-2 font-medium font-jakarta">
              Unlock deeper reputation insights with Pro and Enterprise accounts
            </p>
          </div>
        </DialogHeader>

        <div className="py-4 sm:py-6 px-4 sm:px-6">
          {/* Pricing Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {pricingTiers.map((tier, index) => (
              <div
                key={tier.name}
                className={`relative rounded-2xl border-2 p-4 sm:p-6 transition-all duration-200 hover:shadow-xl flex flex-col ${
                  tier.popular
                    ? 'border-[#DB5E89] bg-gradient-to-b from-[#DB5E89]/5 to-white shadow-lg'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                {tier.popular && (
                  <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                    <Badge className="bg-[#DB5E89] text-white px-4 py-1 text-sm font-semibold">
                      Popular
                    </Badge>
                  </div>
                )}

                <div className="text-center mb-4 sm:mb-6">
                  <h3 className="text-lg sm:text-xl font-bold text-[#13274F] mb-3">{tier.name}</h3>
                  <div className="mb-3">
                    <span className="text-2xl sm:text-3xl font-bold text-[#13274F]">{tier.price}</span>
                    {tier.priceUnit && (
                      <span className="text-lg sm:text-xl text-gray-400 ml-1">{tier.priceUnit}</span>
                    )}
                  </div>
                  <p className="text-gray-600 text-xs sm:text-sm font-medium">{tier.description}</p>
                </div>

                <div className="space-y-2 sm:space-y-3 mb-4 sm:mb-6 flex-grow">
                  {tier.features.map((feature, featureIndex) => (
                    <div key={featureIndex} className="flex items-start gap-2 sm:gap-3">
                      <Check className="w-4 h-4 sm:w-5 sm:h-5 text-[#0DBCBA] mt-0.5 flex-shrink-0" />
                      <span className="text-xs sm:text-sm text-gray-500 leading-relaxed font-light">{feature}</span>
                    </div>
                  ))}
                </div>

                <Button
                  onClick={tier.action}
                  disabled={tier.disabled}
                  variant={tier.buttonVariant}
                  className={`w-full font-semibold h-10 sm:h-12 mt-auto text-sm sm:text-base ${
                    tier.popular
                      ? 'bg-[#DB5E89] text-white hover:bg-[#C54A7A]'
                      : tier.name === "Enterprise"
                      ? 'border-[#0DBCBA] text-[#0DBCBA] hover:bg-[#0DBCBA] hover:text-white'
                      : ''
                  }`}
                >
                  <span className="truncate">{tier.buttonText}</span>
                </Button>
              </div>
            ))}
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}; 