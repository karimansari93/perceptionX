
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle: string;
  icon: LucideIcon;
  iconColor: string;
  children?: ReactNode;
}

export const MetricCard = ({ 
  title, 
  value, 
  subtitle, 
  icon: Icon, 
  iconColor, 
  children 
}: MetricCardProps) => {
  return (
    <Card className="shadow-sm border border-gray-200 hover:shadow-md transition-shadow duration-200">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-medium text-gray-600">
          {title}
        </CardTitle>
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
        <p className="text-xs text-gray-500">{subtitle}</p>
        {children}
      </CardContent>
    </Card>
  );
};
