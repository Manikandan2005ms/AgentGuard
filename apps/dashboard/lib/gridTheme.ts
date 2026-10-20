import { colorSchemeDark, themeQuartz } from "ag-grid-community";

/** AG Grid theme matching the dashboard's dark palette. */
export const gridTheme = themeQuartz.withPart(colorSchemeDark).withParams({
  backgroundColor: "#0d1424",
  foregroundColor: "#e6ebf5",
  headerBackgroundColor: "#121b2f",
  chromeBackgroundColor: "#0d1424",
  borderColor: "#1f2a44",
  oddRowBackgroundColor: "#0f1729",
  accentColor: "#22d3ee",
  rowHoverColor: "#16213a",
  fontSize: 13,
  headerFontSize: 12,
});
