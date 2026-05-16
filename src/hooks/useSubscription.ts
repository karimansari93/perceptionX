// Subscription tiers were removed — every user has full access.
// This hook is kept as a thin, stable shim so existing consumers keep working
// without a codebase-wide rename. It no longer reads the `profiles` table.

const UNLIMITED_LIMITS = {
  prompts: -1, // unlimited
  companies: -1, // unlimited
  teamMembers: -1, // unlimited
  projects: -1, // unlimited
  features: [
    'Full company insights',
    'Unlimited prompts',
    'Unlimited companies',
    'Monthly data updates',
    'Company reports & analytics',
    'All AI models',
    'Priority support',
  ],
};

export const useSubscription = () => {
  const getLimits = () => UNLIMITED_LIMITS;

  return {
    subscription: null,
    loading: false,
    isPro: true,
    isEnterprise: false,
    isFree: false,
    canUpdateData: true,
    canAddPrompt: true,
    canRefreshData: true,
    canAccessAdvancedFeatures: true,
    getLimits,
    refetch: async () => {},
  };
};
