import { create } from "zustand";

export interface RealtimeSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker: string | null;
  translation: string | null;
  isPartial: boolean;
}

interface RealtimeState {
  level: number;
  isLive: boolean;
  vadProb: number;
  vadThreshold: number;
  vadSpeech: boolean;
  segments: RealtimeSegment[];
  setLevel: (db: number) => void;
  setLive: (v: boolean) => void;
  setVadMeter: (prob: number, threshold: number, speech: boolean) => void;
  applyPartial: (s: { start: number; end: number; text: string }) => void;
  applyFinal: (s: { start: number; end: number; text: string; speaker?: string | null; translation?: string | null }) => void;
  clear: () => void;
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  level: -90,
  isLive: false,
  vadProb: 0,
  vadThreshold: 0.5,
  vadSpeech: false,
  segments: [],
  setLevel: (level) => set({ level }),
  setLive: (isLive) => set({ isLive }),
  setVadMeter: (vadProb, vadThreshold, vadSpeech) => set({ vadProb, vadThreshold, vadSpeech }),
  applyPartial: (s) => set((state) => {
    const last = state.segments[state.segments.length - 1];
    if (last && last.isPartial && Math.abs(last.start - s.start) < 0.01) {
      const next = [...state.segments];
      next[next.length - 1] = { ...last, end: s.end, text: s.text };
      return { segments: next };
    }
    return { segments: [...state.segments, { id: crypto.randomUUID(), ...s, speaker: null, translation: null, isPartial: true }] };
  }),
  applyFinal: (s) => set((state) => {
    const next = [...state.segments];
    const last = next[next.length - 1];
    if (last && last.isPartial && Math.abs(last.start - s.start) < 0.05) {
      next[next.length - 1] = { ...last, end: s.end, text: s.text, speaker: s.speaker ?? null, translation: s.translation ?? null, isPartial: false };
      return { segments: next };
    }
    return { segments: [...next, { id: crypto.randomUUID(), start: s.start, end: s.end, text: s.text, speaker: s.speaker ?? null, translation: s.translation ?? null, isPartial: false }] };
  }),
  clear: () => set({ segments: [] }),
}));
