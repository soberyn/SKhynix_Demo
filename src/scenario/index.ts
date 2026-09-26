import { EQUIPMENT_SCENARIO } from "./equipment";
import { TAX_SCENARIO } from "./tax";
import type { Scenario } from "./types";

/** Order = order in the scenario switcher: the original problem first, then the transfer to another domain. */
export const SCENARIOS: Scenario[] = [TAX_SCENARIO, EQUIPMENT_SCENARIO];

export function getScenario(id: string | null | undefined): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
