import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCompany } from '@/contexts/CompanyContext';
import { useSubscription } from '@/hooks/useSubscription';
import { Building2, Check, ChevronDown, Star, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Favicon } from '@/components/ui/favicon';
import { getCountryFlag } from '@/utils/countryFlags';

interface CompanySwitcherProps {
  className?: string;
  variant?: 'default' | 'outline' | 'ghost';
  showAddCompanyModal?: boolean;
  setShowAddCompanyModal?: (show: boolean) => void;
  showUpgradeModal?: boolean;
  setShowUpgradeModal?: (show: boolean) => void;
  alwaysMounted?: boolean;
  locationFilter?: string | null;
}

export const CompanySwitcher = ({ className, variant = 'ghost', showAddCompanyModal, setShowAddCompanyModal, showUpgradeModal, setShowUpgradeModal, alwaysMounted = false, locationFilter }: CompanySwitcherProps) => {
  const { currentCompany, userCompanies, switchCompany, setAsDefaultCompany, loading } = useCompany();
  const { isPro } = useSubscription();
  const [isOpen, setIsOpen] = useState(false);


  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 px-3 py-2', className)}>
        <Building2 className="h-4 w-4 text-gray-400 animate-pulse" />
        <span className="text-sm text-gray-500">Loading...</span>
      </div>
    );
  }

  if (!currentCompany) {
    return null;
  }

  const getCompanyDomain = (companyName: string) => {
    // Convert "Netflix" -> "netflix.com", "T Rowe Price" -> "troweprice.com"
    return companyName.toLowerCase().replace(/\s+/g, '') + '.com';
  };

  const handleAddNewCompany = () => {
    const companyLimit = isPro ? 10 : 3;
    const hasReachedLimit = userCompanies.length >= companyLimit;
    
    if (hasReachedLimit) {
      if (isPro) {
        toast.error('You\'ve reached the 10-company limit. Contact support for higher limits.');
      } else {
        toast.error('You\'ve reached the 3-company limit. Upgrade to Pro for up to 10 companies.');
        setShowUpgradeModal?.(true);
      }
      setIsOpen(false);
      return; // Don't open the modal
    }
    
    // Only open if under limit
    setIsOpen(false);
    setShowAddCompanyModal?.(true);
  };

  const handleSwitchCompany = async (companyName: string, companyId?: string) => {
    try {
      // If companyId is provided, use it directly
      if (companyId) {
        await switchCompany(companyId);
        toast.success('Company switched');
        setIsOpen(false);
        return;
      }

      // Otherwise, find the best company matching the name
      // If location filter is set, prefer company matching that location
      const nameLower = companyName.toLowerCase();
      const matchingCompanies = userCompanies.filter(c => c.name.toLowerCase() === nameLower);
      
      if (matchingCompanies.length === 0) {
        toast.error('Company not found');
        return;
      }

      let targetCompany = matchingCompanies[0];
      
      if (locationFilter && matchingCompanies.length > 1) {
        // Prefer company matching the location filter
        const locationMatch = matchingCompanies.find(c => (c.country || 'GLOBAL') === locationFilter);
        if (locationMatch) {
          targetCompany = locationMatch;
        }
      }

      await switchCompany(targetCompany.id);
      toast.success('Company switched');
      setIsOpen(false);
    } catch (error) {
      toast.error('Failed to switch company');
    }
  };

  const handleSetDefault = async (e: React.MouseEvent, companyId: string) => {
    e.stopPropagation();
    try {
      await setAsDefaultCompany(companyId);
    } catch (error) {
      toast.error('Failed to set default company');
    }
  };

  // Filter companies by location if locationFilter is set
  const filteredCompanies = locationFilter
    ? userCompanies.filter(company => {
        const companyCountry = company.country || 'GLOBAL';
        return companyCountry === locationFilter;
      })
    : userCompanies;

  // Group companies with same name and industry together
  // For display, we only show one company per name (deduplicate by name)
  // But we keep track of all companies with the same name to handle switching
  const companiesByName = filteredCompanies.reduce((acc, company) => {
    const key = company.name.toLowerCase();
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(company);
    return acc;
  }, {} as Record<string, typeof filteredCompanies>);

  // For each unique company name, pick the best company to display:
  // 1. If location filter is set, prefer the one matching that location
  // 2. Otherwise, prefer the current company if it matches the name
  // 3. Otherwise, just pick the first one
  const displayCompanies = Object.entries(companiesByName).map(([name, companies]) => {
    if (companies.length === 1) {
      return companies[0];
    }
    
    // Multiple companies with same name - pick the best one
    if (locationFilter) {
      // Prefer company matching the location filter
      const matchingLocation = companies.find(c => (c.country || 'GLOBAL') === locationFilter);
      if (matchingLocation) return matchingLocation;
    }
    
    // Prefer current company if it matches this name
    const currentMatch = companies.find(c => c.id === currentCompany?.id);
    if (currentMatch) return currentMatch;
    
    // Otherwise just return the first one
    return companies[0];
  });

  return (
    <>
    <DropdownMenu 
      open={isOpen} 
      onOpenChange={setIsOpen}
      {...(alwaysMounted && { forceMount: true })}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          className={cn(
            'flex items-center gap-2 justify-between min-w-[200px] sm:min-w-[200px]',
            className
          )}
        >
          <div className="flex items-center gap-2">
            <Favicon domain={getCompanyDomain(currentCompany.name)} size="sm" />
            <span className="font-medium truncate max-w-[120px] sm:max-w-[150px]">
              {currentCompany.name}
            </span>
          </div>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[250px]">
        <DropdownMenuLabel>Your Companies</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {displayCompanies.map((company) => {
          const isDefault = company.is_default === true;
          const isCurrent = company.id === currentCompany?.id;
          
          // Check if there are multiple companies with the same name
          const nameLower = company.name.toLowerCase();
          const sameNameCompanies = userCompanies.filter(c => c.name.toLowerCase() === nameLower);
          const hasMultipleLocations = sameNameCompanies.length > 1;
          
          return (
            <DropdownMenuItem
              key={company.id}
              onClick={() => handleSwitchCompany(company.name, company.id)}
              className="cursor-pointer flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                {isCurrent && <Check className="h-4 w-4 text-[#13274F]" />}
                {!isCurrent && <div className="h-4 w-4" />}
                <Favicon domain={getCompanyDomain(company.name)} size="sm" />
                <span className={cn(
                  'text-sm',
                  isCurrent && 'font-semibold text-[#13274F]'
                )}>
                  {company.name}
                </span>
              </div>
              <div className="flex items-center justify-center w-6 h-6">
                {!isDefault ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={(e) => handleSetDefault(e, company.id)}
                    title="Set as default"
                  >
                    <Star className="h-4 w-4 text-gray-400 hover:text-yellow-500" />
                  </Button>
                ) : (
                  <div title="Default company" className="flex items-center justify-center">
                    <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                  </div>
                )}
              </div>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleAddNewCompany}
          className="cursor-pointer text-[#13274F] hover:text-[#0DBCBA] hover:bg-[#13274F]/5"
        >
          <Plus className="h-4 w-4 mr-2" />
          <span className="font-medium">Add New Company</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  );
};
