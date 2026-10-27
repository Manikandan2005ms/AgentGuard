/** Plain names for the injection techniques the detectors report (Threats page and Insights). */
export const TECHNIQUE_LABELS: Record<string, string> = {
  css_display_none: "Hidden with display:none",
  css_visibility_hidden: "Hidden with visibility:hidden",
  css_opacity_0: "Fully transparent text",
  css_tiny_font: "Microscopic font size",
  css_offscreen: "Positioned off-screen",
  css_clipped: "Clipped out of view",
  css_zero_height: "Zero-height container",
  css_transparent_text: "Transparent text colour",
  css_same_color_as_background: "Text same colour as background",
  css_white_text: "White-on-white text",
  html_comment: "HTML comment",
  attribute_alt: "Image alt text",
  attribute_title: "Title attribute",
  "attribute_aria-label": "aria-label attribute",
  attribute_content: "Meta content",
  aria_hidden: "aria-hidden element",
  html_hidden_attribute: "hidden attribute",
  structured_data: "JSON-LD structured data",
  unicode_tag_smuggling: "Invisible Unicode tag characters",
  zero_width_characters: "Zero-width characters",
  noscript_content: "<noscript> block",
  template_content: "<template> block",
  llm_classifier: "Flagged by the AI classifier",
};

/** "css_display_none (ignore previous)" -> title "Hidden with display:none", patterns "ignore previous". */
export function techniqueLabel(technique: string) {
  const key = technique.split(" (")[0]!;
  const patterns = /\(([^)]+)\)/.exec(technique)?.[1];
  return { title: TECHNIQUE_LABELS[key] ?? key.replace(/^visible_/, "Visible text: ").replace(/_/g, " "), patterns };
}
