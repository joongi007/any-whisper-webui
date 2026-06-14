export type CaptureSource = "mic" | "tab";

export interface AudioCaptureHandle {
  stop: () => void;
}

export interface CaptureCallbacks {
  onChunk: (pcm: ArrayBuffer) => void;
  onError: (err: unknown) => void;
}

export async function startCapture(source: CaptureSource, cb: CaptureCallbacks): Promise<AudioCaptureHandle> {
  const ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule("/audio-worklet/pcm-encoder.js");

  let stream: MediaStream;
  if (source === "tab") {
    stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("no_tab_audio");
    }
  } else {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
    });
  }

  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-encoder", { processorOptions: { frameMs: 100 } });
  node.port.onmessage = (e) => cb.onChunk(e.data as ArrayBuffer);
  node.onprocessorerror = (e) => cb.onError(e);
  src.connect(node);

  return {
    stop: () => {
      node.port.postMessage("stop");
      try { node.disconnect(); } catch { /* noop */ }
      try { src.disconnect(); } catch { /* noop */ }
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}
