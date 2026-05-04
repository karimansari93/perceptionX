import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useStarredView } from "@/hooks/useStarredView";

interface StarSavedViewProps {
  userId: string | null | undefined;
  currentLocation: string | null;
  currentPeriod: string | null;
  className?: string;
}

export function StarSavedView({ userId, currentLocation, currentPeriod, className }: StarSavedViewProps) {
  const { starredView, saveCurrentView, clearStarred } = useStarredView(userId);
  // Only show as starred when the CURRENT view actually matches the saved one.
  // If the user has drifted to a different country/period, the star reverts
  // to outlined — clicking again saves the new view as their default.
  const matchesSaved =
    starredView !== null &&
    (starredView.location ?? null) === (currentLocation ?? null) &&
    (starredView.period ?? null) === (currentPeriod ?? null);

  const handleClick = () => {
    if (matchesSaved) {
      clearStarred();
    } else {
      saveCurrentView({ location: currentLocation, period: currentPeriod });
    }
  };

  const tooltipText = matchesSaved
    ? "Clear saved view"
    : starredView !== null
      ? "Save this view as your default (replaces previous saved view)"
      : "Save this view as your default — it'll load when you sign back in";

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            onClick={handleClick}
            aria-label={tooltipText}
            aria-pressed={matchesSaved}
            className={className}
          >
            <Star
              className={`h-4 w-4 ${matchesSaved ? "fill-[#DB5E89] text-[#DB5E89]" : "text-gray-500"}`}
              strokeWidth={matchesSaved ? 0 : 2}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
