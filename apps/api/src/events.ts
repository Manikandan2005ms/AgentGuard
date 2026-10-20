import { EventEmitter } from "node:events";
import type { LiveEvent } from "@agentguard/shared";

/** In-process event bus feeding the dashboard's live feed (SSE). */
const bus = new EventEmitter();
bus.setMaxListeners(200);

export function publish(event: LiveEvent): void {
  bus.emit("event", event);
}

export function subscribe(fn: (event: LiveEvent) => void): () => void {
  bus.on("event", fn);
  return () => bus.off("event", fn);
}
