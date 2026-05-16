// Subscription tiers were removed — every user has full access.
// The "Welcome to Pro" onboarding carousel is no longer shown. Kept as a
// no-op so existing call sites keep compiling.

interface WelcomeProModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const WelcomeProModal = (_props: WelcomeProModalProps) => null;
