import { Building2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { OrgBrand } from '@/hooks/useProfileSetup';

interface CompanyBrandSelectProps {
  brands: OrgBrand[];
  // Brand key (lower-cased name) of the selection.
  value: string | null;
  onChange: (key: string) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}

// "Which company do you work with?" — one entry per brand in the user's
// organization (same-name country profiles are one brand, like the
// dashboard's company switcher). Only rendered when there is more than one.
export const CompanyBrandSelect = ({
  brands,
  value,
  onChange,
  disabled = false,
  id,
  className,
}: CompanyBrandSelectProps) => (
  <Select value={value ?? undefined} onValueChange={onChange} disabled={disabled}>
    <SelectTrigger id={id} className={className}>
      <SelectValue placeholder="Choose a company" />
    </SelectTrigger>
    <SelectContent>
      {brands.map((brand) => (
        <SelectItem key={brand.key} value={brand.key}>
          <span className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-gray-400" />
            <span>{brand.name}</span>
            {brand.companies.length > 1 && (
              <span className="text-[11px] text-gray-400">· {brand.companies.length} markets</span>
            )}
          </span>
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);
