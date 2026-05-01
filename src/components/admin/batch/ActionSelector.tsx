import { Card, CardContent } from "@/components/ui/card";
import { RefreshCw, Plus, Building2, Cpu, LayoutGrid, Sparkles } from "lucide-react";

export type BatchAction = "recollect" | "expand" | "bulk_expand" | "collect_model" | "analyze_themes" | "new_company";

type Props = {
  onSelect: (action: BatchAction) => void;
};

const actions: { key: BatchAction; icon: typeof RefreshCw; title: string; description: string }[] = [
  {
    key: "recollect",
    icon: RefreshCw,
    title: "Re-collect data",
    description: "Re-run AI collection for existing companies and prompts",
  },
  {
    key: "expand",
    icon: Plus,
    title: "Expand coverage",
    description: "Add new locations, industries, or functions to existing companies",
  },
  {
    key: "bulk_expand",
    icon: LayoutGrid,
    title: "Bulk expand",
    description: "Queue multiple companies with different job functions each, run all together",
  },
  {
    key: "collect_model",
    icon: Cpu,
    title: "Collect single model",
    description: "Re-run only one AI model (e.g. Perplexity) for selected companies",
  },
  {
    key: "analyze_themes",
    icon: Sparkles,
    title: "Analyze themes",
    description: "Fill theme-analysis gaps for responses that never got themes extracted",
  },
  {
    key: "new_company",
    icon: Building2,
    title: "Add new company",
    description: "Set up a brand new company with locations and industries",
  },
];

export const ActionSelector = ({ onSelect }: Props) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
    {actions.map(({ key, icon: Icon, title, description }) => (
      <Card
        key={key}
        className="cursor-pointer hover:border-primary hover:shadow-md transition-all"
        onClick={() => onSelect(key)}
      >
        <CardContent className="flex flex-col items-center text-center gap-3 pt-6 pb-4">
          <div className="p-3 rounded-full bg-primary/10">
            <Icon className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-sm">{title}</p>
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          </div>
        </CardContent>
      </Card>
    ))}
  </div>
);
