import { z } from "zod";

export const LOYALTY_LEDGER_TYPES = [
  "EARN",
  "REDEEM",
  "REVERSE_EARN",
  "REFUND_REDEEM",
  "EXPIRE",
  "ADJUST",
] as const;

export type LoyaltyLedgerType = (typeof LOYALTY_LEDGER_TYPES)[number];

export const UpdateLoyaltySettingsSchema = z.object({
  isEnabled: z.boolean().default(false),
  earnRateMinor: z.coerce.number().int().positive().default(10000),
  pointValueMinor: z.coerce.number().int().positive().default(100),
  minRedeemPoints: z.coerce.number().int().min(0).default(100),
  maxBillSharePercent: z.coerce.number().int().min(1).max(100).default(50),
  expiryMonths: z.coerce.number().int().min(1).max(60).default(12),
});

export type UpdateLoyaltySettingsInput = z.infer<typeof UpdateLoyaltySettingsSchema>;

export const AdjustLoyaltyPointsSchema = z.object({
  points: z.number().int(),
  reason: z.string().trim().min(1, "Reason is required").max(500),
});

export type AdjustLoyaltyPointsInput = z.infer<typeof AdjustLoyaltyPointsSchema>;

export const LoyaltyLedgerQuerySchema = z.object({
  type: z.enum(LOYALTY_LEDGER_TYPES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type LoyaltyLedgerQueryInput = z.infer<typeof LoyaltyLedgerQuerySchema>;
