import { apiClient } from "./client";

export interface YouTubeMeta {
  title: string | null;
  duration_sec: number | null;
  thumbnail: string | null;
  uploader: string | null;
  available_subtitles: string[];
}

export async function fetchYouTubeMeta(url: string): Promise<YouTubeMeta> {
  const { data } = await apiClient.post<{ data: YouTubeMeta }>("/api/v1/youtube/meta", { url });
  return data.data;
}
