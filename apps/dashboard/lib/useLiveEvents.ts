"use client";

import type { LiveEvent } from "@agentguard/shared";
import { useEffect, useRef, useState } from "react";
import { API_URL } from "./api";

/** Subscribes to the API's Server-Sent Events stream. EventSource reconnects on its own. */
export function useLiveEvents(onEvent: (e: LiveEvent) => void): boolean {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource(`${API_URL}/api/events`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      try {
        handler.current(JSON.parse(msg.data) as LiveEvent);
      } catch {
        /* ignore malformed */
      }
    };
    return () => es.close();
  }, []);

  return connected;
}
