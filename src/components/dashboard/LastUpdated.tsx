import { useState, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { RefreshCw, Clock } from "lucide-react";

interface LastUpdatedProps {
  onRefresh: () => Promise<void>;
  lastUpdated?: Date;
}

export const LastUpdated = ({ onRefresh, lastUpdated }: LastUpdatedProps) => {
  const [isUpdating, setIsUpdating] = useState(false);

  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      await onRefresh();
    } catch (error) {
      console.error('Error updating data:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  // Memoize the formatted time to prevent constant re-renders
  const formattedTime = useMemo(() => {
    if (!lastUpdated) return 'Never';

    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - lastUpdated.getTime()) / (1000 * 60));

    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;

    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays}d ago`;

    return lastUpdated.toLocaleDateString();
  }, [lastUpdated]);

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <Clock className="w-4 h-4" />
        <span className="hidden sm:inline">Last collected: {formattedTime}</span>
        <span className="sm:hidden">{formattedTime}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleUpdate}
        disabled={isUpdating}
        className="h-8 px-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100"
        title="Refresh data"
      >
        <RefreshCw className={`w-4 h-4 ${isUpdating ? 'animate-spin' : ''}`} />
      </Button>
    </div>
  );
};
