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
          <div className="text-3xl font-extrabold text-gray-900 mb-1 leading-tight">
            {value}
          </div>
        )}
        <div className="flex items-center justify-between mt-1">
          <p className="text-xs text-gray-500 truncate max-w-[70%]">{subtitle}</p>
          {trend && value !== 'No data available' && (
            <div className={`flex items-center space-x-1 text-xs font-medium ${getTrendColor()}`}>
              {getTrendIcon()}
              <span>{trend.value}%</span>
            </div>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
};
