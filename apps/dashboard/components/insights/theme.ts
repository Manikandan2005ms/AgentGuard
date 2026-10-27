import { studioTheme } from "ag-studio";
import { mono, sans, serif } from "@/lib/fonts";
import { PALETTE } from "@/lib/palette";

/**
 * AG Studio on the ledger palette: paper canvas, sheet-white widget cards with a hairline rule,
 * serif widget titles like the rest of the dashboard, and the decision colours for charts.
 * Values come from lib/palette.ts (the globals.css tokens) because Studio's charts draw on a canvas.
 */

// Chart series: the decision colours first (approved, asked, blocked), so a chart of the three decisions reads
// green / amber / red; then the accent blue, then quiet extras. Studio charts take no per-series colours.
const SERIES = [PALETTE.okFill, PALETTE.warnFill, PALETTE.badFill, PALETTE.accentFill, "#7d6a9e", "#4e8a8a", "#a8714a", "#8a8578"];
const palette = Object.fromEntries(
  SERIES.flatMap((color, i) => [
    [`chartPaletteFills${i + 1}Color`, color],
    [`chartPaletteStrokes${i + 1}Color`, color],
  ]),
);
const hairline = (color: string) => ({ width: 1, color });

export const insightsTheme = studioTheme.withParams({
  fontFamily: sans.style.fontFamily,
  fontSize: 13,
  textColor: PALETTE.ink,
  foregroundColor: PALETTE.ink,
  subtleTextColor: PALETTE.ink3,
  backgroundColor: PALETTE.sheet,
  borderColor: PALETTE.rule,
  accentColor: PALETTE.accent,
  iconColor: PALETTE.ink2,
  rowHoverColor: "#f1ecdf",

  // The canvas is the page's own paper; Studio's frame disappears into it.
  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: PALETTE.paper,
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: PALETTE.paper,
  studioCanvasGridLineColor: PALETTE.rule,
  studioCanvasPadding: 0,
  studioCanvasRowHeight: 16,
  studioCanvasFontFamily: sans.style.fontFamily,

  // Widgets are the dashboard's .sheet cards.
  studioWidgetBackgroundColor: PALETTE.sheet,
  studioWidgetBorder: hairline(PALETTE.rule),
  studioWidgetBorderRadius: 6,
  studioWidgetPadding: 6,
  studioWidgetTitleFontFamily: serif.style.fontFamily,
  studioWidgetTitleFontSize: 18,
  studioWidgetTitleFontWeight: 500,
  studioWidgetTitleTextColor: PALETTE.ink,
  studioWidgetSubtitleFontFamily: sans.style.fontFamily,
  studioWidgetSubtitleFontSize: 12.5,
  studioWidgetSubtitleTextColor: PALETTE.ink3,
  studioWidgetCaptionFontFamily: sans.style.fontFamily,
  studioWidgetCaptionFontSize: 12,
  studioWidgetCaptionTextColor: PALETTE.ink3,
  studioWidgetResizeBorderColor: PALETTE.accent,

  // Edit-mode panels: more paper, with the accent for the selected control.
  studioPanelContainerBackgroundColor: PALETTE.sheet,
  studioPanelContainerBorder: hairline(PALETTE.rule),
  studioPanelContainerBorderRadius: 6,
  studioPanelDividerColor: PALETTE.rule,
  studioPanelDividerActiveColor: PALETTE.accent,
  studioPanelSectionBorderColor: PALETTE.rule,
  studioPanelHeaderFontFamily: serif.style.fontFamily,
  studioPanelHeaderFontSize: 16,
  studioPanelHeaderFontWeight: 500,
  studioPanelChevronButtonHoverBackgroundColor: PALETTE.paper,
  studioPanelChevronButtonHoverColor: PALETTE.accent,
  studioToggleButtonActiveBackgroundColor: "#e4e8f2",
  studioToggleButtonActiveBorderColor: PALETTE.accent,
  studioToggleButtonActiveColor: PALETTE.accent,
  studioAiPanelInputMessageBackgroundColor: PALETTE.paper,

  // Grid widgets match the audit log.
  gridFontFamily: sans.style.fontFamily,
  gridFontSize: 13,
  gridHeaderBackgroundColor: PALETTE.paper,
  gridHeaderTextColor: PALETTE.ink2,
  gridHeaderFontWeight: 600,
  gridHeaderFontSize: 12.5,
  gridRowHeight: 34,
  gridRowBorder: hairline("#ebe5d7"),
  gridHeaderRowBorder: hairline(PALETTE.rule),
  gridRowHoverColor: "#f1ecdf",
  gridWrapperBorder: false,

  // Charts.
  chartFontFamily: sans.style.fontFamily,
  chartTextColor: PALETTE.ink2,
  chartAxisLineColor: PALETTE.rule2,
  chartGridLineColor: "#ebe5d7",
  ...palette,
});

export const monoFamily = mono.style.fontFamily;
