// Subscription tiers were removed — every user has full access.
// This modal no longer renders any upgrade/pricing UI. Kept as a no-op so
// existing call sites keep compiling; call sites are being removed incrementally.

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const UpgradeModal = (_props: UpgradeModalProps) => null;
