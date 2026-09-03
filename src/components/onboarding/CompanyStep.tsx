import { Building2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OrgBrand } from '@/hooks/useProfileSetup';

interface CompanyStepProps {
  brands: OrgBrand[];
  // Brand key of the selection; null = nothing chosen yet.
  value: string | null;
  onSelect: (key: string) => void;
  disabled?: boolean;
}

// "Which company do you work with?" — one tile per brand in the user's
// organization. Nothing is preselected: the choice has to be made.
export const CompanyStep = ({ brands, value, onSelect, disabled = false }: CompanyStepProps) => (
  <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1" role="radiogroup">
    {brands.map((brand) => {
      const selected = value === brand.key;
      return (
        <button
          type="button"
          key={brand.key}
          role="radio"
          aria-checked={selected}
          disabled={disabled}
          onClick={() => onSelect(brand.key)}
          className={cn(
            'flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition disabled:opacity-50',
            selected ? 'border-pink bg-pink/5' : 'border-gray-200 bg-white hover:border-gray-300',
          )}
        >
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition',
              selected ? 'bg-pink text-white' : 'bg-gray-100 text-gray-500',
            )}
          >
            <Building2 className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                'block truncate text-[14px]',
                selected ? 'font-semibold text-nightsky' : 'font-medium text-nightsky/90',
              )}
            >
              {brand.name}
            </span>
            {brand.companies.length > 1 && (
              <span className="block text-[11px] text-gray-400">{brand.companies.length} markets</span>
            )}
          </span>
          {selected && <Check className="h-4 w-4 shrink-0 text-pink" strokeWidth={3} />}
        </button>
      );
    })}
  </div>
);
