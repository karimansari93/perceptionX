
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle } from "lucide-react";

interface ConfirmationCardProps {
  isConfirming: boolean;
  onConfirm: () => void;
  disabled?: boolean;
}

export const ConfirmationCard = ({ isConfirming, onConfirm, disabled }: ConfirmationCardProps) => {
  return (
    <div className="text-center mt-12">
      <Card className="inline-block bg-blue-50 border-blue-200">
        <CardContent className="p-6">
          <h3 className="text-lg font-semibold text-blue-900 mb-2">
            Ready to start comprehensive monitoring?
          </h3>
          <p className="text-blue-700 mb-4">
            Confirm these prompts and we'll start testing them across multiple AI models to track sentiment, visibility, and competitive positioning.
          </p>
          <Button 
            onClick={onConfirm}
            className="bg-blue-600 hover:bg-blue-700"
            size="lg"
            disabled={isConfirming || disabled}
          >
            {isConfirming ? (
              <>
                Testing Enhanced Prompts...
              </>
            ) : (
              <>
                <CheckCircle className="w-5 h-5 mr-2" />
                Confirm & Start Enhanced Monitoring
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
