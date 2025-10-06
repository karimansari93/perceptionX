import { useState, useEffect, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Clock, Crown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { UpgradeModal } from "@/components/upgrade/UpgradeModal";
import { useSubscription } from '@/hooks/useSubscription';

interface LastUpdatedProps {
  onRefresh: () => Promise<void>;
  lastUpdated?: Date;
}

export const LastUpdated = ({ onRefresh, lastUpdated }: LastUpdatedProps) => {
  const { user } = useAuth();
  const { isPro, canRefreshData } = useSubscription();
  const [isUpdating, setIsUpdating] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const handleUpdate = async () => {
    if (!canRefreshData) {
      setShowUpgradeModal(true);
      return;
    }
    
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
    <>
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Clock className="w-4 h-4" />
          <span className="hidden sm:inline">Last collected: {formattedTime}</span>
          <span className="sm:hidden">{formattedTime}</span>
        </div>
        
        {!isPro && (
          <Badge 
            variant="secondary" 
            className="bg-amber-100 text-amber-800 border-amber-200 cursor-pointer hover:bg-amber-200"
            onClick={() => setShowUpgradeModal(true)}
          >
            <Crown className="w-3 h-3 mr-1" />
            <span className="hidden sm:inline">Upgrade for extended access</span>
            <span className="sm:hidden">Upgrade</span>
          </Badge>
        )}
      </div>

      <UpgradeModal 
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
      />
    </>
  );
}; 