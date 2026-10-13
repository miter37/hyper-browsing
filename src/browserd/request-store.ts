import crypto from "node:crypto";

interface RequestRecord { signature: string; at: number; state: "running" | "completed" | "failed"; promise: Promise<any>; result?: any; error?: string; execution?: string }
export class RequestStore {
  private records = new Map<string, RequestRecord>();
  async run(id: string, method: string, params: unknown, execute: () => Promise<any>) {
    if (!/^[\w-]{1,100}$/.test(id)) throw new Error("Invalid request id");
    const signature = crypto.createHash("sha256").update(JSON.stringify({ method, params })).digest("hex");
    const previous = this.records.get(id);
    if (previous) {
      if (previous.signature !== signature) throw new Error("Request ID conflicts with another payload");
      return previous.promise;
    }
    for (const [key, value] of this.records) if (value.state !== "running" && Date.now() - value.at > 300000) this.records.delete(key);
    if (this.records.size >= 512) {
      const oldest = [...this.records].find(([, v]) => v.state !== "running");
      if (oldest) this.records.delete(oldest[0]); else throw new Error("Request capacity reached before execution");
    }
    const record: RequestRecord = { signature, at: Date.now(), state: "running", promise: Promise.resolve() };
    record.promise = Promise.resolve().then(execute).then(result => { record.at = Date.now(); record.state = "completed"; record.result = result; return result; }, error => {
      record.at = Date.now(); record.state = "failed"; record.error = error?.message || String(error); record.execution = error.execution === "not_started" ? "not_started" : "outcome_unknown"; throw error;
    });
    this.records.set(id, record);
    return record.promise;
  }
  status(id: string) {
    const record = this.records.get(id);
    if (!record || (record.state !== "running" && Date.now() - record.at > 300000)) return { state: "unknown", execution: "outcome_unknown", hint: "Request result is unavailable; observe the page. Do not resend." };
    return { state: record.state, execution: record.state === "failed" ? record.execution : record.state === "running" ? "outcome_unknown" : record.result?.execution || "completed", result: record.result, error: record.error };
  }
}
