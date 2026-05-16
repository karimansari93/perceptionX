// Subscription tiers were removed — every user has full access.
// Kept as a thin no-op shim so any remaining imports keep compiling.

export class SubscriptionService {
  static async getUserSubscription(_userId: string) {
    return { subscription_type: 'pro', prompts_used: 0, subscription_start_date: null };
  }

  static async incrementPromptsUsed(_userId: string) {
    // No-op: prompt usage is no longer metered.
    return null;
  }

  static async canAddPrompt(_userId: string): Promise<boolean> {
    return true;
  }

  static async upgradeToPro(_userId: string): Promise<void> {
    // No-op: all users already have full access.
  }

  static async canUpdateData(_userId: string): Promise<boolean> {
    return true;
  }

  static async ensureTalentXProPrompts(_userId: string): Promise<void> {
    // No-op: TalentX prompts are provisioned through the normal prompt flow.
  }
}
