import type { AppConfig } from "../config";
import { readToken } from "./token";
import { postRpc } from "../../scripts/rpc-transport.mjs";

export class BrowserdClient {
  constructor(private config: AppConfig) {}

  async call<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const token = await readToken(this.config).catch(() => {
      throw new Error("browserd token not found. Start browserd first.");
    });
    const response = await postRpc({ endpoint: `http://${this.config.host}:${this.config.port}`, token, method, params: { verbose: process.argv.includes("--verbose"), ...params } });
    return response.result as T;
  }
}
