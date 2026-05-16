// Subscription tiers were removed — every user has full access.
// This banner no longer renders. Kept as a no-op so existing call sites
// keep compiling; call sites are being removed incrementally.

interface UpgradeBannerProps {
  currentPrompts: number;
  totalPrompts: number;
  companyName?: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const UpgradeBanner = (_props: UpgradeBannerProps) => null;
