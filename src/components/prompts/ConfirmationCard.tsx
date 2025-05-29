import { Button } from "@/components/ui/button";
import { CheckCircle } from "lucide-react";

interface ConfirmationCardProps {
  isConfirming: boolean;
  onConfirm: () => void;
  disabled?: boolean;
}

export const ConfirmationCard = ({ isConfirming, onConfirm, disabled }: ConfirmationCardProps) => {
  return (
    <Button 
      onClick={onConfirm}
      className="bg-blue-600 hover:bg-blue-700"
      size="lg"
      disabled={isConfirming || disabled}
    >
      {isConfirming ? (
        <>Testing Enhanced Prompts...</>
      ) : (
        <>
          <CheckCircle className="w-5 h-5 mr-2" />
          Confirm & Start Enhanced Monitoring
        </>
      )}
    </Button>
  );
};
