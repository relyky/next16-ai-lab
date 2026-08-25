/**
 * 伺服器端設定：集中讀取環境變數。
 *
 * 一律於請求時讀取而非模組載入時求值——頂層常數只會被求值一次，
 * 會讓不同設定組合難以測試。
 * 設定不加 `NEXT_PUBLIC_` 前綴，避免被打包進 client bundle。
 */
export type ServerConfig = {
  /** 模型別名（'fable' | 'opus' | 'sonnet' | 'haiku'）或完整 model ID。 */
  llmModel: string;
};

/** 未設定 `LLM_MODEL` 時採用的模型。 */
const DEFAULT_LLM_MODEL = "haiku";

export function getServerConfig(): ServerConfig {
  return {
    // 空字串與純空白視同未設定。
    llmModel: process.env.LLM_MODEL?.trim() || DEFAULT_LLM_MODEL,
  };
}
