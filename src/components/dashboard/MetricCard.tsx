import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LucideIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { ReactNode } from "react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle: string;
  icon?: LucideIcon;
  iconColor?: string;
  trend?: {
    value: number;
    direction: 'up' | 'down' | 'neutral';
  };
  children?: ReactNode;
  tooltip?: string;
}

export const MetricCard = ({ 
  title, 
  value, 
  subtitle, 
  icon: Icon, 
  iconColor,
  trend,
  children,
  tooltip
}: MetricCardProps) => {
  const getTrendIcon = () => {
    if (!trend) return null;
    switch (trend.direction) {
      case 'up':
        return <TrendingUp className="w-4 h-4 text-green-500" />;
      case 'down':
        return <TrendingDown className="w-4 h-4 text-red-500" />;
      default:
        return <Minus className="w-4 h-4 text-gray-400" />;
    }
  };

  const getTrendColor = () => {
    if (!trend) return '';
    switch (trend.direction) {
      case 'up':
        return 'text-green-500';
      case 'down':
        return 'text-red-500';
      default:
        return 'text-gray-400';
    }
  };

  // Special handling for perception score
  const isPerceptionScore = title === "Perception Score";
  const getPerceptionScoreColor = () => {
    if (!isPerceptionScore || value === 'No data available') return '';
    const score = typeof value === 'string' ? parseInt(value.split('/')[0]) : 0;
    if (score >= 80) return 'text-green-600';
    if (score >= 65) return 'text-blue-600';
    if (score >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <Card className="bg-gray-50/80 border-0 shadow-none rounded-xl p-0 h-full flex flex-col justify-between hover:shadow-md transition-shadow duration-200">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-3 px-4">
        <div className="flex items-center gap-1">
          <CardTitle className="text-xs font-semibold text-gray-500 tracking-wide">
            {title}
          </CardTitle>
          {tooltip && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="ml-1 cursor-pointer align-middle">
                    <HelpCircle className="w-4 h-4 text-gray-400 hover:text-gray-600" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {tooltip}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        {Icon && iconColor && <Icon className={`w-5 h-5 ${iconColor}`} />}
      </CardHeader>
      <CardContent className="pt-0 px-4 pb-3 flex-1 flex flex-col justify-center">
        {value === 'No data available' ? (
          <div className="text-base font-semibold text-gray-500 mb-0 mt-2 leading-tight min-h-[32px] flex items-center">
            {value}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className={`text-3xl font-extrabold leading-tight ${isPerceptionScore ? getPerceptionScoreColor() : 'text-gray-900'}`}>
              {value}
            </div>
            {isPerceptionScore && value !== 'No data available' && (
              <div className="relative">
                <svg width="40" height="40" viewBox="0 0 40 40" className="transform -rotate-90">
                  <circle
                    cx="20"
                    cy="20"
                    r="16"
                    fill="none"
                    stroke="#e5e7eb"
                    strokeWidth="3"
                  />
                  <circle
                    cx="20"
                    cy="20"
                    r="16"
                    fill="none"
                    stroke={getPerceptionScoreColor().replace('text-', '').includes('green') ? '#22c55e' :
                           getPerceptionScoreColor().replace('text-', '').includes('blue') ? '#3b82f6' :
                           getPerceptionScoreColor().replace('text-', '').includes('yellow') ? '#eab308' :
                           '#ef4444'}
                    strokeWidth="3"
                    strokeDasharray={2 * Math.PI * 16}
                    strokeDashoffset={2 * Math.PI * 16 * (1 - (typeof value === 'string' ? parseInt(value.split('/')[0]) : 0) / 100)}
                    strokeLinecap="round"
                    style={{ transition: 'stroke-dashoffset 0.4s, stroke 0.4s' }}
                  />
                </svg>
              </div>
            )}
          </div>
        )}
        <div className="flex items-center justify-between mt-1">
          <p className="text-xs text-gray-500 truncate max-w-[70%]">{subtitle}</p>
          {trend && value !== 'No data available' && (
            <div className={`flex items-center space-x-1 text-xs font-medium ${getTrendColor()}`}>
              {getTrendIcon()}
              <span>{Math.round(trend.value)}%</span>
            </div>
          )}
        </div>
        {children}
        {isPerceptionScore && value !== 'No data available' && (
          <div className="px-4 pb-3">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
              <span>Sentiment</span>
              <span>Visibility</span>
              <span>Relevance</span>
              <span>Competitive</span>
            </div>
            <div className="flex gap-1">
              <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-green-500 transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, (typeof value === 'string' ? parseInt(value.split('/')[0]) : 0) * 0.4))}%` }}
                />
              </div>
              <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, (typeof value === 'string' ? parseInt(value.split('/')[0]) : 0) * 0.35))}%` }}
                />
              </div>
              <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-orange-500 transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, (typeof value === 'string' ? parseInt(value.split('/')[0]) : 0) * 0.0))}%` }}
                />
              </div>
              <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-purple-500 transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, (typeof value === 'string' ? parseInt(value.split('/')[0]) : 0) * 0.25))}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
