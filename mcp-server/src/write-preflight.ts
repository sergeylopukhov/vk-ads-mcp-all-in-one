import type { VkObject } from "./vk-client.js";

export interface WritePreflightCheck {
  code: string;
  status: "pass" | "fail";
  message: string;
}

export interface WritePreflightResult extends Record<string, unknown> {
  ready: boolean;
  checks: WritePreflightCheck[];
}

function objectiveList(item: VkObject): string[] | null {
  const value = item.objective;
  if (typeof value === "string" && value.length > 0) return [value];
  if (Array.isArray(value) && value.every((objective) => typeof objective === "string" && objective.length > 0)) {
    return value as string[];
  }
  return null;
}

/** Проверяет только наблюдаемые поля packages.json и не предполагает скрытые цели пакета. */
export function validateTestAdPlanDraft(
  draft: { package_id: number; objective: string },
  packages: VkObject[],
): WritePreflightResult {
  const item = packages.find((candidate) => Number(candidate.id) === draft.package_id);
  if (!item) {
    return { ready: false, checks: [{ code: "package", status: "fail", message: `package_id=${draft.package_id} не найден в доступных packages.` }] };
  }
  const objectives = objectiveList(item);
  if (!objectives) {
    return { ready: false, checks: [{ code: "package_objective", status: "fail", message: "У package отсутствует наблюдаемое поле objective; создание не будет угадано." }] };
  }
  const objectiveReady = objectives.includes(draft.objective);
  return {
    ready: objectiveReady,
    checks: [
      { code: "package", status: "pass", message: `package_id=${draft.package_id} подтверждён в текущем кабинете.` },
      objectiveReady
        ? { code: "objective", status: "pass", message: `Цель «${draft.objective}» разрешена выбранным package.` }
        : { code: "objective", status: "fail", message: `Цель «${draft.objective}» не разрешена package; доступны: ${objectives.join(", ")}.` },
    ],
  };
}

/** Проверяет существование родительского плана и доступность выбранного пакета. */
export function validateTestAdGroupParent(
  adPlan: VkObject,
  packageId: number,
  packages: VkObject[],
): WritePreflightResult {
  const packageFound = packages.some((item) => Number(item.id) === packageId);
  const checks: WritePreflightCheck[] = [
    { code: "ad_plan", status: "pass", message: "Родительский ad plan подтверждён в текущем кабинете." },
    packageFound
      ? { code: "package", status: "pass", message: `package_id=${packageId} подтверждён в текущем кабинете.` }
      : { code: "package", status: "fail", message: `package_id=${packageId} не найден в доступных packages.` },
  ];
  return { ready: checks.every((check) => check.status === "pass"), checks };
}
