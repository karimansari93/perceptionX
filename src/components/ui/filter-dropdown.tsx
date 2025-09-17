import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

interface FilterDropdownProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  options: FilterOption[];
  className?: string;
}

export const FilterDropdown: React.FC<FilterDropdownProps> = ({
  value,
  onValueChange,
  placeholder,
  options,
  className = "w-full"
}) => {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <div className="flex items-center gap-2">
              <span>{option.label}</span>
              {option.count !== undefined && (
                <span className="text-xs text-gray-500">({option.count})</span>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

interface FilterGridProps {
  children: React.ReactNode;
  className?: string;
}

export const FilterGrid: React.FC<FilterGridProps> = ({
  children,
  className = "w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
}) => {
  return (
    <div className={className}>
      {children}
    </div>
  );
};
