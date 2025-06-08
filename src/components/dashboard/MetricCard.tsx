import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LucideIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { ReactNode } from "react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle: string;
  icon: LucideIcon;
  iconColor: string;
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
        return <Minus className="w-4 h-4 text-gray-500" />;
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
        return 'text-gray-500';
    }
  };

  return (
    <Card className="shadow-sm border border-gray-200 hover:shadow-md transition-shadow duration-200">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-1">
          <CardTitle className="text-sm font-medium text-gray-600">
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
        <Icon className={`w-5 h-5 ${iconColor}`} />
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-2xl font-bold text-gray-900 mb-1" style={{
          color: typeof value === 'string' && value.includes('%') ? 
            (parseFloat(value) > 10 ? '#10b981' : parseFloat(value) < -10 ? '#ef4444' : '#374151') : 
            '#374151'
        }}>
          {value}
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">{subtitle}</p>
          {trend && (
            <div className={`flex items-center space-x-1 text-xs font-medium ${getTrendColor()}`}>
              {getTrendIcon()}
              <span>{trend.value}% vs last week</span>
            </div>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
};
