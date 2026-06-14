import { apiClient } from "./client";

export interface FileUploaded {
  file_id: string;
  filename: string;
  size_bytes: number;
  duration_sec: number | null;
  mime_type: string | null;
}

export async function uploadFile(file: File, onProgress?: (pct: number) => void): Promise<FileUploaded> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<{ data: FileUploaded }>("/api/v1/files", form, {
    onUploadProgress: (e) => { if (e.total) onProgress?.(e.loaded / e.total); },
    timeout: 0,
  });
  return data.data;
}
