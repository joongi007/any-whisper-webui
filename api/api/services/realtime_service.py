from __future__ import annotations

import asyncio
import json

import structlog
from fastapi import WebSocket, WebSocketDisconnect

from api import nats_client
from api.constants import KIND_REALTIME
from api.db import get_session_factory
from api.deps import new_id
from api.repositories.job_repo import JobRepository

log = structlog.get_logger()


class RealtimeBridge:
    """Bridges browser WebSocket ↔ NATS subjects for realtime STT.

    Persistence (added in Iter 17 / pending #20):
      The session is materialised as a Job(kind=realtime, id=sid) in the DB so
      it lands in History exactly like a file/youtube job. `final` segments
      arriving from ai are written through `JobRepository.add_segment`, so the
      existing transcript export endpoint Just Works without a new code path.
      Audio IS persisted by the ai Streamer (when cfg.record is on, the default)
      to /data/outputs/{sid}/input_16k.wav + peaks.json — same paths as file
      jobs — so the JobDetail player, editing, and region-retranscribe all work
      on realtime sessions too. With record off, the player 404s and hides.

    Worker affinity protocol (multi-instance safe):
      1. browser → api : ws `start` (JSON cfg)
      2. api → ai      : NATS req-reply on `realtime.start` (queue group `ai-workers`)
      3. one ai worker creates the Streamer and replies with `{worker_id, session_id}`
      4. api forwards chunks to `realtime.worker.{worker_id}.{sid}.chunk|flush|stop`
      5. ai → api responses (level/vad/partial/final/error/stopped) stay on
         `realtime.{sid}.*` since sid is unique system-wide.
    """

    def __init__(self, ws: WebSocket) -> None:
        self.ws = ws
        self.sid = new_id()
        self.worker_id: str | None = None
        self._subs: list = []
        self._closed = False
        self._segment_seq = 0           # monotonic counter for DB add_segment
        self._row_created = False       # set True once Job row is INSERTed
        self._last_language: str | None = None
        self._last_end_sec: float = 0.0
        self._cfg: dict | None = None

    async def run(self) -> None:
        first = await self.ws.receive_text()
        try:
            cfg = json.loads(first)
        except json.JSONDecodeError:
            await self.ws.send_json({"type": "error", "code": "validation_error"})
            return
        cfg["session_id"] = self.sid
        self._cfg = cfg

        # 1. subscribe to ai-side response subjects first (avoid races on early events)
        for leaf in ("ready", "level", "vad", "vad_meter", "partial", "final", "error", "stopped"):
            sub = await nats_client.nc().subscribe(
                f"realtime.{self.sid}.{leaf}", cb=self._on_event,
            )
            self._subs.append(sub)

        # 2. ask the ai pool to claim this session. First call can take minutes
        # while the worker downloads + loads the whisper model — be generous.
        log.info("realtime_start_requested", sid=self.sid, backend=cfg.get("backend"), model=cfg.get("model"))
        resp = await nats_client.request("realtime.start", cfg, timeout=180.0)
        if not resp or not resp.get("ok"):
            err = (resp or {}).get("error", "ai worker unavailable")
            log.warning("realtime_start_failed", sid=self.sid, error=err)
            await self.ws.send_json({"type": "error", "code": "no_worker", "message": err})
            return
        self.worker_id = resp["worker_id"]
        log.info("realtime_start_ok", sid=self.sid, worker_id=self.worker_id)

        # 2.5. Materialise the session as a Job row so History/JobDetail can show it.
        # Done after worker confirmation so we don't leave orphan rows when ai is down.
        await self._ensure_row()

        # 3. forward incoming WS frames to the elected worker's inbox
        try:
            while True:
                msg = await self.ws.receive()
                if msg["type"] == "websocket.disconnect":
                    break
                if "bytes" in msg and msg["bytes"] is not None:
                    await nats_client.publish_plain(self._chunk_subject(), msg["bytes"])
                elif "text" in msg and msg["text"] is not None:
                    try:
                        obj = json.loads(msg["text"])
                    except json.JSONDecodeError:
                        continue
                    t = obj.get("type")
                    if t == "flush":
                        await nats_client.publish_plain(self._control_subject("flush"), b"")
                    elif t == "stop":
                        await nats_client.publish_plain(self._control_subject("stop"), b"")
                        break
                    elif t == "ping":
                        await self.ws.send_json({"type": "pong"})
                    elif t == "config":
                        cfg_patch = {k: v for k, v in obj.items() if k != "type"}
                        await nats_client.publish_plain(
                            self._control_subject("config"),
                            json.dumps(cfg_patch).encode(),
                        )
        except WebSocketDisconnect:
            pass
        finally:
            await self._cleanup()

    # ─── DB persistence ──────────────────────────────────────────────────

    async def _ensure_row(self) -> None:
        """Create the Job row the first time we know ai accepted the session."""
        if self._row_created or self._cfg is None:
            return
        try:
            async with get_session_factory()() as session:
                await JobRepository(session).create(
                    job_id=self.sid, kind=KIND_REALTIME,
                    request=self._cfg, file_asset_id=None,
                )
                # Realtime starts running immediately — there's no queue.
                await JobRepository(session).mark_running(self.sid)
            self._row_created = True
        except Exception:  # noqa: BLE001
            log.exception("realtime_row_create_failed", sid=self.sid)

    async def _persist_final(self, payload: dict) -> None:
        if not self._row_created:
            await self._ensure_row()
        if not self._row_created:
            return
        self._segment_seq += 1
        try:
            end = float(payload.get("end") or 0.0)
            self._last_end_sec = max(self._last_end_sec, end)
            async with get_session_factory()() as session:
                await JobRepository(session).add_segment(
                    job_id=self.sid, seq=self._segment_seq,
                    start=float(payload.get("start") or 0.0),
                    end=end,
                    text=str(payload.get("text") or ""),
                    speaker=payload.get("speaker"),
                    translation=(payload.get("translation") or {}).get("text")
                                if isinstance(payload.get("translation"), dict) else None,
                )
        except Exception:  # noqa: BLE001
            log.exception("realtime_segment_persist_failed", sid=self.sid, seq=self._segment_seq)

    async def _finalize_row(self) -> None:
        if not self._row_created:
            return
        try:
            async with get_session_factory()() as session:
                await JobRepository(session).mark_succeeded(self.sid, result={
                    "transcript_id": self.sid,
                    "language": self._last_language,
                    "duration_sec": self._last_end_sec,
                    "output_files": [],
                })
        except Exception:  # noqa: BLE001
            log.exception("realtime_finalize_failed", sid=self.sid)

    # ─── NATS routing ────────────────────────────────────────────────────

    def _chunk_subject(self) -> str:
        return f"realtime.worker.{self.worker_id}.{self.sid}.chunk"

    def _control_subject(self, leaf: str) -> str:
        return f"realtime.worker.{self.worker_id}.{self.sid}.{leaf}"

    async def _on_event(self, msg) -> None:
        if self._closed:
            return
        try:
            payload = json.loads(msg.data.decode()) if msg.data else {}
        except json.JSONDecodeError:
            return
        leaf = msg.subject.split(".")[-1]
        payload["type"] = leaf

        # Persist only `final` segments — `partial` is a UI affordance that
        # gets overwritten by the next partial / final.
        if leaf == "final":
            await self._persist_final(payload)

        try:
            await self.ws.send_json(payload)
        except Exception:  # noqa: BLE001
            self._closed = True

    async def _cleanup(self) -> None:
        self._closed = True
        for s in self._subs:
            try:
                await s.unsubscribe()
            except Exception:  # noqa: BLE001
                pass
        if self.worker_id is not None:
            try:
                await nats_client.publish_plain(self._control_subject("stop"), b"")
            except Exception:  # noqa: BLE001
                pass
        # Persist the closing state so the row leaves History as "succeeded"
        # with a usable transcript, not as an orphan stuck on "running".
        await self._finalize_row()
        try:
            await self.ws.close()
        except Exception:  # noqa: BLE001
            pass
        await asyncio.sleep(0)
