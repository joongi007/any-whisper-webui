import { apiClient } from "./client";

export interface GpuInfo {
  available: boolean;
  name?: string;
  vram_total_mb?: number;
  cuda?: string;
}

export interface LoadedModel {
  backend: string;
  model: string | null;
  idle_sec: number | null;
}

export interface SystemInfo {
  gpu: GpuInfo;
  ffmpeg_version: string | null;
  backends_available: string[];
  translate_providers: string[];
  uvr_models: string[];
  diarize_available: boolean;
  /** Token is configured but gated-access may be unconfirmed. Distinguishes
   *  "no token" from "token set, terms not accepted yet". */
  diarize_token_present: boolean;
  /** Precise blocker: null | "no_token" | "terms" | "permission" | "network". */
  diarize_reason: string | null;
  loaded_models: LoadedModel[];
  default_backend: string | null;
  default_model: string | null;
  ai_online: boolean;
}

export interface WhisperModelOption {
  id: string;
  label: string;
  size_mb_estimated: number | null;
}

export async function fetchSystemInfo(): Promise<SystemInfo> {
  const { data } = await apiClient.get<{ data: SystemInfo }>("/api/v1/system/info");
  return data.data;
}

export interface GpuStats {
  available: boolean;
  ai_online: boolean;
  util_pct?: number;
  mem_used_mb?: number;
  mem_total_mb?: number;
  temp_c?: number;
  power_w?: number | null;
}

export async function fetchGpuStats(): Promise<GpuStats> {
  const { data } = await apiClient.get<{ data: GpuStats }>("/api/v1/system/gpu/stats");
  return data.data;
}

export async function fetchModels(backend: string): Promise<WhisperModelOption[]> {
  const { data } = await apiClient.get<{ data: { models: WhisperModelOption[] } }>(
    "/api/v1/system/models",
    { params: { backend } },
  );
  return data.data.models;
}

export async function loadModel(backend: string, model: string): Promise<LoadedModel[]> {
  const { data } = await apiClient.post<{ data: { loaded: LoadedModel[] } }>(
    "/api/v1/system/models/load", { backend, model },
  );
  return data.data.loaded;
}

export async function unloadModel(backend: string): Promise<boolean> {
  const { data } = await apiClient.post<{ data: { unloaded: boolean } }>(
    "/api/v1/system/models/unload", { backend },
  );
  return data.data.unloaded;
}

export interface BenchmarkStrategy {
  strategy: string;          // "sequential" | "batched_8" | "concurrent_2" | ...
  wall_sec?: number;
  runs?: number;
  throughput_xrt?: number;   // audio-seconds processed per wall-second
  peak_vram_mb?: number | null;
  error?: string;
}

export interface BenchmarkResult {
  hardware: {
    gpu_available: boolean; gpu_name: string | null; vram_total_mb: number | null;
    cuda: string | null; gpu_count: number; unified_memory: boolean; cpu_count: number | null;
  };
  audio_sec: number;
  model: string;
  compute_type: string;
  results: BenchmarkStrategy[];
  recommendation: {
    max_performance?: string;
    balanced?: string;
    safe?: string;
    notes?: string[];
    error?: string;
  };
  // Top-level signals: "already_running" (a run is already in progress) or a
  // partial result flagged cancelled.
  error?: string;
  cancelled?: boolean;
}

export async function runBenchmark(
  opts: { model?: string; compute_type?: string; clip_sec?: number; job_id?: string } = {},
): Promise<BenchmarkResult> {
  const { data } = await apiClient.post<{ data: BenchmarkResult }>(
    "/api/v1/system/benchmark", opts, { timeout: 320_000 },
  );
  return data.data;
}

export async function cancelBenchmark(): Promise<void> {
  await apiClient.post("/api/v1/system/benchmark/cancel");
}

export interface CacheInfo {
  size_bytes: number;
  file_count: number;
  max_gb: number;
}

export async function fetchCacheInfo(): Promise<CacheInfo> {
  const { data } = await apiClient.get<{ data: CacheInfo }>("/api/v1/system/cache");
  return data.data;
}

export async function clearCache(): Promise<{ deleted: number; freed_bytes: number }> {
  const { data } = await apiClient.delete<{ data: { deleted: number; freed_bytes: number } }>(
    "/api/v1/system/cache",
  );
  return data.data;
}
