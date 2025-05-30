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
      className="bg-pink-600 hover:bg-pink-700"
      size="lg"
      disabled={isConfirming || disabled}
    >
      {isConfirming ? (
        <>Loading...</>
      ) : (
        <>
          <CheckCircle className="w-5 h-5 mr-2" />
          I'm ready
        </>
      )}
    </Button>
  );
};
