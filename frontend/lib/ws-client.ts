/**
 * Typed WebSocket client. Sole entry point for the frontend to talk to the
 * backend's WS endpoints. Every message in or out is a `ClientMessage` or
 * `ServerMessage` from the shared contract — no untyped payloads.
 */

import type {
  ClientMessage,
  ServerMessage,
  SessionId,
  SpeakerRole,
} from "@contract";

export type CaptionStreamHandlers = {
  onMessage: (msg: ServerMessage) => void;
  onError?: (err: Event) => void;
  onClose?: (ev: CloseEvent) => void;
};

export class CaptionStream {
  private ws: WebSocket | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly sessionId: SessionId,
    private readonly role: SpeakerRole,
  ) {}

  connect(handlers: CaptionStreamHandlers): void {
    const path = this.role === "speaker" ? "audio" : "captions";
    this.ws = new WebSocket(`${this.baseUrl}/ws/${path}/${this.sessionId}`);

    this.ws.addEventListener("open", () => {
      this.send({
        type: "session.attach",
        sessionId: this.sessionId,
        role: this.role,
      });
    });

    this.ws.addEventListener("message", (ev) => {
      // TODO: validate against a zod schema if we adopt one; for now trust the
      // contract on the wire and let TS narrow downstream.
      const msg = JSON.parse(ev.data) as ServerMessage;
      handlers.onMessage(msg);
    });

    if (handlers.onError) this.ws.addEventListener("error", handlers.onError);
    if (handlers.onClose) this.ws.addEventListener("close", handlers.onClose);
  }

  send(msg: ClientMessage): void {
    this.ws?.send(JSON.stringify(msg));
  }

  /** Speaker-only: push a raw audio chunk. */
  sendAudio(chunk: ArrayBuffer | Blob): void {
    this.ws?.send(chunk);
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
