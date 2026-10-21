import { themeQuartz } from "ag-grid-community";
import { mono, sans } from "./fonts";
import { PALETTE } from "./palette";

/** AG Grid on the dashboard's paper palette. */
export const gridTheme = themeQuartz.withParams({
  backgroundColor: PALETTE.sheet,
  foregroundColor: PALETTE.ink,
  textColor: PALETTE.ink,
  subtleTextColor: PALETTE.ink3,
  headerBackgroundColor: PALETTE.paper,
  headerTextColor: PALETTE.ink2,
  headerFontWeight: 600,
  chromeBackgroundColor: PALETTE.paper,
  borderColor: PALETTE.rule,
  oddRowBackgroundColor: "#f8f5ee",
  rowHoverColor: "#f1ecdf",
  selectedRowBackgroundColor: "#e9e2cf",
  rangeSelectionBorderColor: PALETTE.accent,
  rangeSelectionBackgroundColor: "rgba(36, 64, 143, 0.08)",
  accentColor: PALETTE.accent,
  inputFocusBorder: { color: PALETTE.accent },
  wrapperBorderRadius: 6,
  borderRadius: 4,
  fontFamily: sans.style.fontFamily,
  dataFontSize: 13,
  fontSize: 13,
  headerFontSize: 12.5,
  cellFontFamily: sans.style.fontFamily,
  menuBackgroundColor: PALETTE.sheet,
  tooltipBackgroundColor: PALETTE.ink,
  tooltipTextColor: PALETTE.sheet,
});

export const monoFamily = mono.style.fontFamily;
