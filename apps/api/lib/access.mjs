const TRIAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export function computeAccess(profile, subscriptions = [], now = new Date(), proEntitlementId = "pro") {
  const startedAt = new Date(profile.free_trial_started_at);
  const endsAt = new Date(startedAt.getTime() + TRIAL_DAYS * DAY_MS);
  const isPro = subscriptions.some(
    (subscription) => subscription.is_active === true && subscription.entitlement_id === proEntitlementId
  );
  const isTrialActive = now.getTime() < endsAt.getTime();
  const elapsedDays = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / DAY_MS));

  return {
    is_pro: isPro,
    is_trial_active: isTrialActive,
    requires_paywall: !isPro && !isTrialActive,
    trial_day: isTrialActive ? elapsedDays + 1 : TRIAL_DAYS + 1,
    free_trial_ends_at: endsAt.toISOString()
  };
}
