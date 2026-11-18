import { db, PosOfflineDatabase } from "./db";
import { getEstimatedServerTime, getServerClockOffset } from "./clock";

export function formatBusinessDate(
  timestampMs: number,
  timeZone = "Asia/Dhaka"
): { yymmdd: string; fullDate: string } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(timestampMs));
  const year = parts.find((p) => p.type === "year")?.value || "00";
  const month = parts.find((p) => p.type === "month")?.value || "01";
  const day = parts.find((p) => p.type === "day")?.value || "01";
  return {
    yymmdd: `${year}${month}${day}`,
    fullDate: `20${year}-${month}-${day}`,
  };
}

/**
 * Generate the next sequential offline invoice number for a register.
 * Atomically increments the daily counter in Dexie storage.
 * Restarts at 1 on every new business day in the specified timezone.
 */
export async function getNextOfflineInvoiceNumber(params: {
  registerId: string;
  registerCode: string;
  timeZone?: string;
  timestampMs?: number;
  database?: PosOfflineDatabase;
}): Promise<{ invoiceNumber: string; seq: number; date: string }> {
  const targetDb = params.database || db;
  const timeZone = params.timeZone || "Asia/Dhaka";
  const offset = await getServerClockOffset();
  const now = params.timestampMs ?? getEstimatedServerTime(offset);

  const { yymmdd, fullDate } = formatBusinessDate(now, timeZone);

  return await targetDb.transaction("rw", targetDb.counters, async () => {
    const existing = await targetDb.counters.get([params.registerId, fullDate]);
    const nextSeq = existing ? existing.lastSeq + 1 : 1;

    await targetDb.counters.put({
      registerId: params.registerId,
      date: fullDate,
      lastSeq: nextSeq,
    });

    const seqPadded = String(nextSeq).padStart(4, "0");
    const invoiceNumber = `${params.registerCode}-O-${yymmdd}-${seqPadded}`;

    return {
      invoiceNumber,
      seq: nextSeq,
      date: fullDate,
    };
  });
}
