import { apiClient } from "./client";

export interface JobView {
  job_id: string;
  kind: string;
  status: string;
  stage: string;
  progress: number;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  error: { code: string; message: string } | null;
  result: {
    transcript_id?: string;
    output_files?: { format: string; path?: string }[];
    language?: string | null;
    duration_sec?: number | null;
  } | null;
  // Summary fields surfaced by the server for History/Dashboard cards.
  source_kind: "file" | "youtube" | "realtime" | null;
  source_label: string | null;
  backend: string | null;
  model: string | null;
  language: string | null;
  duration_sec: number | null;
  segment_count: number | null;
}

export interface TranscribeRequestPayload {
  source: { kind: "file"; file_id: string } | { kind: "youtube"; url: string };
  backend?: string;
  model?: string;
  language?: string;
  task?: "transcribe" | "translate";
  preprocess?: {
    vad?: { enabled: boolean; threshold?: number };
    uvr?: { enabled: boolean; model?: string; stem?: "vocals" | "instrumental" };
  };
  postprocess?: {
    diarize?: { enabled: boolean; min_speakers?: number | null; max_speakers?: number | null };
    translate_text?: { enabled: boolean; provider?: "nllb" | "deepl"; target_lang?: string };
  };
  options?: { word_timestamps?: boolean; compute_type?: string };
}

export async function createTranscribeJob(payload: TranscribeRequestPayload): Promise<{ job_id: string }> {
  const { data } = await apiClient.post<{ data: { job_id: string; status: string } }>("/api/v1/jobs/transcribe", payload);
  return { job_id: data.data.job_id };
}

export async function getJob(jobId: string): Promise<JobView> {
  const { data } = await apiClient.get<{ data: JobView }>(`/api/v1/jobs/${jobId}`);
  return data.data;
}

export async function listJobs(params: { kind?: string; status?: string; page?: number; size?: number } = {}): Promise<{ items: JobView[]; total: number }> {
  const { data } = await apiClient.get<{ data: { items: JobView[]; total: number } }>("/api/v1/jobs", { params });
  return data.data;
}

/** Permanent delete: removes DB row + cascades segments + best-effort wipes
 *  /data/outputs/{job_id}/. */
export async function deleteJob(jobId: string): Promise<void> {
  await apiClient.delete(`/api/v1/jobs/${jobId}`);
}

/** Best-effort delete via fetch keepalive — survives a page unload, so the
 *  bulk-delete undo timer can flush pending IDs on F5 / tab-close instead of
 *  silently losing the commit. Don't await; the browser owns the request
 *  once the page is gone. */
export function deleteJobKeepalive(jobId: string): void {
  try {
    void fetch(`/api/v1/jobs/${jobId}`, { method: "DELETE", keepalive: true });
  } catch {
    // Silent — last-ditch effort during unload.
  }
}

/** Stop a running/queued job. Marks the row cancelled and signals the ai
 *  worker via NATS so the inference task is `.cancel()`'d at the next await
 *  boundary (usually within ~1 segment). Already-terminal jobs are a no-op. */
export async function cancelJob(jobId: string): Promise<{ cancelled: boolean; status: string }> {
  const { data } = await apiClient.post<{ data: { cancelled: boolean; status: string } }>(
    `/api/v1/jobs/${jobId}/cancel`,
  );
  return data.data;
}

/** Resubmit a terminal (succeeded/failed/cancelled) transcribe job with the
 *  same request payload. Returns the new job id; the original row is kept. */
export async function retryJob(jobId: string): Promise<{ job_id: string }> {
  const { data } = await apiClient.post<{ data: { job_id: string; status: string } }>(
    `/api/v1/jobs/${jobId}/retry`,
  );
  return { job_id: data.data.job_id };
}
