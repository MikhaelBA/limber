import { createRuntimeBudget, validateRuntimeBudget, type RuntimeBudget } from '@limber/runtime';

export const SHIP_BUDGET_STORAGE_KEY = 'bonebybone.ship-budget.v1';
export function readShipBudget(storage: Pick<Storage, 'getItem'>): {
  budget: RuntimeBudget;
  warning?: string;
} {
  try {
    const saved = storage.getItem(SHIP_BUDGET_STORAGE_KEY);
    return { budget: saved === null ? createRuntimeBudget() : validateRuntimeBudget(JSON.parse(saved)) };
  } catch {
    return {
      budget: createRuntimeBudget(),
      warning: 'Saved platform budget could not be read. Web preset restored.',
    };
  }
}
export function saveShipBudget(storage: Pick<Storage, 'setItem'>, budget: RuntimeBudget): RuntimeBudget {
  const owned = validateRuntimeBudget(budget);
  storage.setItem(SHIP_BUDGET_STORAGE_KEY, JSON.stringify(owned));
  return owned;
}
