import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UpgradeModal } from "@/components/upgrade/UpgradeModal";

interface UpgradeBannerProps {
  currentPrompts: number;
  totalPrompts: number;
  companyName?: string;
}

export const UpgradeBanner = ({ currentPrompts, totalPrompts, companyName = 'your company' }: UpgradeBannerProps) => {
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  
  const percentage = Math.round((currentPrompts / totalPrompts) * 100);

  return (
    <>
      <Card className="bg-gradient-to-r from-cyan-50 to-teal-50 border-cyan-200 shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex-1">
                  <p className="text-gray-700 text-base">
                    You're monitoring <span className="font-semibold text-[#0DBCBA]">{percentage}%</span> of conversations about {companyName}.
                  </p>
                  <p className="text-gray-600 text-sm mt-1">
                    Upgrade to Pro for {totalPrompts - currentPrompts} more prompts covering Diversity & Inclusion, Work-Life Balance, and more.
                  </p>
                </div>
                <Button 
                  onClick={() => setShowUpgradeModal(true)}
                  className="bg-[#0DBCBA] hover:bg-[#0DBCBA]/90 text-white w-full sm:w-auto sm:ml-4"
                >
                  Upgrade to Pro
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <UpgradeModal 
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
      />
    </>
  );
};
