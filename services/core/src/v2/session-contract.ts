import type { DailyPlan, PlannedItem, PromptRole } from "./types.js";

const REQUIRED_SLOT_ROLES: readonly PromptRole[] = [
  "anchor",
  "contrast",
  "transfer_word",
  "sentence",
  "review"
];

/**
 * Validates the stable wire/storage contract for a v2 Program Day. This does
 * not decide learning policy; it only prevents a client or content adapter
 * from changing the five-required / two-optional product boundary.
 */
export function assertDailyPlanContract(plan: DailyPlan): void {
  if (plan.requiredCount !== 5 || plan.requiredItems.length !== 5) {
    throw new TypeError("A v2 Program Day must contain exactly five required items.");
  }
  if (plan.optionalItems.length > 2) {
    throw new TypeError("A v2 Program Day may contain at most two optional items.");
  }
  plan.requiredItems.forEach((item, index) => {
    assertPlannedItem(item, index + 1, true, REQUIRED_SLOT_ROLES[index]);
  });
  plan.optionalItems.forEach((item, index) => {
    assertPlannedItem(item, plan.requiredItems.length + index + 1, false, "optional_extension");
  });
  const itemKeys = [...plan.requiredItems, ...plan.optionalItems].map((item) => item.practiceItemKey);
  if (new Set(itemKeys).size !== itemKeys.length) {
    throw new TypeError("A v2 Program Day cannot reuse the same practice item key.");
  }
}

function assertPlannedItem(
  item: PlannedItem,
  expectedPosition: number,
  required: boolean,
  expectedSlotRole: PromptRole
): void {
  if (item.position !== expectedPosition || item.required !== required || item.slotRole !== expectedSlotRole) {
    throw new TypeError("The v2 required/optional item contract is invalid.");
  }
  if (!required && (item.promptRole !== "optional_extension" || item.selectionReason !== "optional_extension")) {
    throw new TypeError("Optional v2 items must be optional extensions.");
  }
}
