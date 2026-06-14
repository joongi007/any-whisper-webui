export interface StartConfig {
  backend: string;
  model: string;
  language: string;
  task: "transcribe" | "translate";
  vad: { enabled: boolean; threshold: number };
  translateText: { enabled: boolean; provider: "nllb" | "deepl"; target_lang: string };
  options?: Record<string, unknown>;
  /** Persist session audio so it can be played back / edited afterwards. */
  record?: boolean;
}

type ServerEvent =
  | { type: "ready"; session_id: string }
  | { type: "level"; rms_db: number }
  | { type: "vad"; speech: boolean }
  | { type: "vad_meter"; prob: number; threshold: number; speech: boolean }
  | { type: "partial"; start: number; end: number; text: string }
  | { type: "final"; start: number; end: number; text: string; speaker: string | null;
      translation: { provider: string; target_lang: string; text: string } | null }
  | { type: "stopped" }
  | { type: "error"; code: string; message: string };

export class RealtimeStream {
  private ws: WebSocket | null = null;

  constructor(private listeners: { onEvent: (e: ServerEvent) => void; onClose: () => void }) {}

  connect(cfg: StartConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/realtime`;
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: "start", backend: cfg.backend, model: cfg.model, language: cfg.language, task: cfg.task,
          vad: cfg.vad,
          translate_text: { enabled: cfg.translateText.enabled, provider: cfg.translateText.provider, target_lang: cfg.translateText.target_lang },
          audio: { sample_rate: 16000, channels: 1, format: "pcm_s16le", chunk_ms: 100 },
          options: cfg.options ?? {},
          record: cfg.record ?? true,
        }));
        resolve();
      };
      ws.onerror = (e) => reject(e);
      ws.onmessage = (e) => {
        try { this.listeners.onEvent(JSON.parse(e.data) as ServerEvent); } catch { /* ignore */ }
      };
      ws.onclose = () => { this.ws = null; this.listeners.onClose(); };
    });
  }

  sendPcm(pcm: ArrayBuffer) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm);
  }

  /** Live config tweak: e.g. `sendConfig({ vad: { enabled: true, threshold: 0.4 }})`.
   *  Forwarded to ai via NATS `realtime.worker.{wid}.{sid}.config`. */
  sendConfig(patch: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "config", ...patch }));
    }
  }

  flush() { this.ws?.send(JSON.stringify({ type: "flush" })); }
  stop() { this.ws?.send(JSON.stringify({ type: "stop" })); this.ws?.close(); }
}
