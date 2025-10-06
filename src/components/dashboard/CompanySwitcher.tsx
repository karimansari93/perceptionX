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

interface CompanySwitcherProps {
  className?: string;
  variant?: 'default' | 'outline' | 'ghost';
  showAddCompanyModal?: boolean;
  setShowAddCompanyModal?: (show: boolean) => void;
  showUpgradeModal?: boolean;
  setShowUpgradeModal?: (show: boolean) => void;
  alwaysMounted?: boolean;
}

export const CompanySwitcher = ({ className, variant = 'ghost', showAddCompanyModal, setShowAddCompanyModal, showUpgradeModal, setShowUpgradeModal, alwaysMounted = false }: CompanySwitcherProps) => {
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

  const handleSwitchCompany = async (companyId: string) => {
    try {
      await switchCompany(companyId);
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
        {userCompanies.map((company) => {
          const isDefault = company.is_default === true;
          const isCurrent = company.id === currentCompany?.id;
          
          return (
            <DropdownMenuItem
              key={company.id}
              onClick={() => handleSwitchCompany(company.id)}
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
