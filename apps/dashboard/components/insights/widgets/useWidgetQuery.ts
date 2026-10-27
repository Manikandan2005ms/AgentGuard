"use client";

import type { AgWidgetApi, AgWidgetDataQuery } from "ag-studio";
import { useEffect, useRef, useState } from "react";

/**
 * Runs a custom widget's query whenever Studio hands it new params (data, filters, mapping), and
 * keeps Studio's overlay in step: "incompleteDataMapping" when `query` is null, a loading overlay
 * on the first load only, and "noData" when `read` finds nothing. An `optional` query is extra
 * detail on a widget that shows something anyway, so it never puts an overlay over it.
 */
export function useWidgetQuery<T>(
  widgetApi: AgWidgetApi,
  query: AgWidgetDataQuery | null,
  read: (rows: Record<string, unknown>[]) => T | null,
  deps: unknown,
  { optional = false }: { optional?: boolean } = {},
): T | null {
  const [value, setValue] = useState<T | null>(null);
  const loaded = useRef(false);
  const readRef = useRef(read);
  readRef.current = read;

  useEffect(() => {
    if (!query) {
      widgetApi.setDisplayState(optional ? "displayed" : "incompleteDataMapping");
      setValue(null);
      return;
    }
    let cancelled = false;
    if (!optional) widgetApi.setDisplayState("loading", { prominent: !loaded.current });
    widgetApi
      .getData(query)
      .then((res) => {
        if (cancelled) return;
        const next = readRef.current(res.results.rows);
        loaded.current = next !== null;
        setValue(next);
        widgetApi.setDisplayState(next === null && !optional ? "noData" : "displayed");
      })
      .catch(() => {
        // A newer request cancels this one; that one sets the state.
      });
    return () => {
      cancelled = true;
    };
    // `deps` is the widget's params object, which Studio replaces whenever anything the query depends on changes.
  }, [deps]);

  return value;
}
