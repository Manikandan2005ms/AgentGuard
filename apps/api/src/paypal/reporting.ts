import { paypalRequest } from "./client";

export interface ReportedTransaction {
  transactionId: string;
  status: string;
  amount: number | null;
  date: string | null;
}

/**
 * GET /v1/reporting/transactions (README §8.6). Sandbox data can lag by hours,
 * so this is only used for background reconciliation.
 */
export async function listTransactions(start: Date, end: Date): Promise<ReportedTransaction[]> {
  const out: ReportedTransaction[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await paypalRequest<{
      transaction_details?: {
        transaction_info?: {
          transaction_id?: string;
          transaction_status?: string;
          transaction_amount?: { value?: string };
          transaction_initiation_date?: string;
        };
      }[];
      total_pages?: number;
    }>("GET", "/v1/reporting/transactions", {
      query: {
        start_date: start.toISOString().replace(/\.\d{3}Z$/, "Z"),
        end_date: end.toISOString().replace(/\.\d{3}Z$/, "Z"),
        fields: "transaction_info",
        page_size: "500",
        page: String(page),
      },
    });
    for (const d of res.transaction_details ?? []) {
      const t = d.transaction_info;
      if (!t?.transaction_id) continue;
      out.push({
        transactionId: t.transaction_id,
        status: t.transaction_status ?? "",
        amount: t.transaction_amount?.value ? Number(t.transaction_amount.value) : null,
        date: t.transaction_initiation_date ?? null,
      });
    }
    totalPages = res.total_pages ?? 1;
    page++;
  } while (page <= totalPages && page <= 10);
  return out;
}
