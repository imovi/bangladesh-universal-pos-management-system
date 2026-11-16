import type { TranslationKeys } from "./bn";

export function formatPaymentMethod(method: string | null | undefined, strings: TranslationKeys): string {
  if (!method) return "—";
  const m = method.toLowerCase().replace(/[\s-]/g, "_") as keyof TranslationKeys["enums"]["paymentMethod"];
  return strings.enums.paymentMethod[m] || method;
}

export function formatSaleStatus(status: string | null | undefined, strings: TranslationKeys): string {
  if (!status) return "—";
  const s = status.toLowerCase() as keyof TranslationKeys["enums"]["saleStatus"];
  return strings.enums.saleStatus[s] || status;
}

export function formatShiftStatus(status: string | null | undefined, strings: TranslationKeys): string {
  if (!status) return "—";
  const s = status.toLowerCase() as keyof TranslationKeys["enums"]["shiftStatus"];
  return strings.enums.shiftStatus[s] || status;
}

export function formatPoStatus(status: string | null | undefined, strings: TranslationKeys): string {
  if (!status) return "—";
  const s = status.toLowerCase().replace(/[\s-]/g, "_") as keyof TranslationKeys["enums"]["poStatus"];
  return strings.enums.poStatus[s] || status;
}

export function formatMovementType(type: string | null | undefined, strings: TranslationKeys): string {
  if (!type) return "—";
  const t = type.toLowerCase().replace(/[\s-]/g, "_") as keyof TranslationKeys["enums"]["movementType"];
  return strings.enums.movementType[t] || type;
}

export function formatRoleName(role: string | null | undefined, strings: TranslationKeys): string {
  if (!role) return "—";
  const r = role.toLowerCase() as keyof TranslationKeys["enums"]["roles"];
  return strings.enums.roles[r] || role;
}
