import React from 'react';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, WifiOff, RefreshCw } from 'lucide-react';
import { Button } from "@/components/ui/button";

interface NetworkStatusProps {
  isOnline: boolean;
  connectionError: string | null;
  onRetry?: () => void;
  className?: string;
}

export const NetworkStatus: React.FC<NetworkStatusProps> = ({
  isOnline,
  connectionError,
  onRetry,
  className = ""
}) => {
  // Don't show anything if everything is fine
  if (isOnline && !connectionError) {
    return null;
  }

  // Determine message and icon based on state
  const getStatusInfo = () => {
    if (!isOnline) {
      return {
        message: "No internet connection. Please check your network.",
        icon: <WifiOff className="h-4 w-4" />,
        variant: "destructive" as const,
        className: "border-red-200 bg-red-50"
      };
    }
    
    return {
      message: connectionError || "Connection issues detected.",
      icon: <AlertTriangle className="h-4 w-4" />,
      variant: "destructive" as const,
      className: "border-orange-200 bg-orange-50"
    };
  };

  const statusInfo = getStatusInfo();

  return (
    <Alert variant={statusInfo.variant} className={`${className} ${statusInfo.className}`}>
      {statusInfo.icon}
      <AlertDescription className="flex items-center justify-between">
        <span>{statusInfo.message}</span>
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="ml-2 h-8"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
};


