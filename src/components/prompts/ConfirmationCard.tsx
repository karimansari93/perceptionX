import { Button } from "@/components/ui/button";
import { CheckCircle } from "lucide-react";

interface ConfirmationCardProps {
  isConfirming: boolean;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}

export const ConfirmationCard = ({ isConfirming, onConfirm, disabled, className }: ConfirmationCardProps) => {
  return (
    <Button 
      onClick={onConfirm}
      variant="default"
      className={`w-full ${className || ''}`}
      size="lg"
      disabled={isConfirming || disabled}
    >
      {isConfirming ? (
        <>Loading...</>
      ) : (
        <>Continue</>
      )}
    </Button>
  );
};
