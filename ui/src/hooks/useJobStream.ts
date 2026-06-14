import { useEffect, useRef } from "react";

export interface JobStreamEvent { type: string; [k: string]: unknown }

interface Options {
  /** Fires every time the socket transitions to OPEN — including reconnects.
   *  Callers should use this to refetch authoritative state from the API
   *  (events fired while the socket was down are lost). */
  onOpen?: () => void;
  /** When false, no socket is opened (and an existing one is torn down). Use
   *  this for terminal jobs: the server closes the socket immediately for
   *  finished jobs, which without this flag would trigger an endless
   *  reconnect → refetch → close loop. Default true. */
  enabled?: boolean;
}

/** WebSocket subscription to `/ws/jobs/{id}` with automatic reconnect.
 *
 *  Why reconnect: a job can fail or finish while the socket is briefly down
 *  (network blip, laptop sleep, dev-server restart). Without reconnect +
 *  refetch-on-open, the page renders stale "running" state indefinitely.
 *  Backoff caps at 5s.
 *
 *  Why NOT always reconnect: the server closes the socket *cleanly* (code
 *  1000) as soon as it sees a terminal job — there are no more events to
 *  stream. Reconnecting after a clean close would loop forever. So we only
 *  reconnect on *abnormal* closes (1006 etc., i.e. real network drops) and
 *  honour the `enabled` flag the caller flips off once the job is terminal. */
export function useJobStream(
  jobId: string | null,
  onEvent: (e: JobStreamEvent) => void,
  options: Options = {},
) {
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;
  const openRef = useRef(options.onOpen);
  openRef.current = options.onOpen;
  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!jobId || !enabled) return;
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/jobs/${jobId}`;

    let ws: WebSocket | null = null;
    let cancelled = false;
    let reconnectTimer: number | null = null;
    let attempt = 0;

    function connect() {
      if (cancelled) return;
      ws = new WebSocket(url);
      ws.onopen = () => {
        attempt = 0;
        openRef.current?.();
      };
      ws.onmessage = (e) => {
        try { cbRef.current(JSON.parse(e.data) as JobStreamEvent); } catch { /* ignore */ }
      };
      ws.onclose = (ev) => {
        if (cancelled) return;
        // Clean close (1000) = server is done with this job on purpose; do not
        // reconnect or we loop on terminal jobs. Only retry abnormal closes.
        if (ev.code === 1000) return;
        attempt += 1;
        // Exponential-ish: 0.5s, 1s, 2s, 4s, 5s, 5s, ...
        const delay = Math.min(500 * 2 ** (attempt - 1), 5000);
        reconnectTimer = window.setTimeout(connect, delay);
      };
      ws.onerror = () => {
        // onclose will fire and handle the reconnect; just ensure we don't
        // print a noisy stack to the console for an expected disconnect.
        try { ws?.close(); } catch { /* noop */ }
      };
    }

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
      try { ws?.close(); } catch { /* noop */ }
    };
  }, [jobId, enabled]);
}
