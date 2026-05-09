import sanitizeHtml, { type IOptions } from "sanitize-html";

const EMAIL_SAFE_OPTIONS: IOptions = {
  allowedTags: [
    "a", "abbr", "address", "article", "b", "blockquote", "br", "caption",
    "center", "code", "div", "em", "figcaption", "figure", "h1", "h2", "h3",
    "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre", "s", "section",
    "small", "span", "strong", "sub", "sup", "table", "tbody", "td", "tfoot",
    "th", "thead", "tr", "u", "ul",
  ],
  allowedAttributes: {
    "*": ["style", "class", "id", "align", "valign", "title", "role"],
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "width", "height", "loading"],
    table: ["border", "cellpadding", "cellspacing", "width", "bgcolor"],
    td: ["colspan", "rowspan", "width", "height", "bgcolor"],
    th: ["colspan", "rowspan", "width", "height", "bgcolor", "scope"],
    tr: ["bgcolor"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: {
    // Inline images must be hosted on our public-assets route (or any
    // remote https URL). data: URIs are intentionally rejected — they
    // bloat email size, break Gmail's image proxy, and broaden the XSS
    // surface in the preview iframe.
    img: ["http", "https", "cid"],
  },
  allowedSchemesAppliedToAttributes: ["href", "src", "cite"],
  allowProtocolRelative: false,
  allowedStyles: {
    "*": {
      color: [/.*/],
      "background-color": [/.*/],
      // Forbid `url(...)` in shorthand `background` — gradients only.
      // Anchored negative lookahead-free pattern: reject any value that
      // contains the substring `url(`.
      background: [/^(?!.*url\().*$/i],
      "background-image": [/^linear-gradient\([^)]*\)$/i],
      "text-align": [/^(left|right|center|justify)$/],
      "font-size": [/.*/],
      "font-weight": [/.*/],
      "font-family": [/.*/],
      "font-style": [/.*/],
      "line-height": [/.*/],
      "letter-spacing": [/.*/],
      "text-decoration": [/.*/],
      "text-transform": [/.*/],
      padding: [/.*/], "padding-top": [/.*/], "padding-right": [/.*/],
      "padding-bottom": [/.*/], "padding-left": [/.*/],
      margin: [/.*/], "margin-top": [/.*/], "margin-right": [/.*/],
      "margin-bottom": [/.*/], "margin-left": [/.*/],
      border: [/.*/], "border-top": [/.*/], "border-right": [/.*/],
      "border-bottom": [/.*/], "border-left": [/.*/],
      "border-radius": [/.*/], "border-color": [/.*/],
      width: [/.*/], "max-width": [/.*/], "min-width": [/.*/],
      height: [/.*/], "max-height": [/.*/], "min-height": [/.*/],
      display: [/.*/],
      "vertical-align": [/.*/],
      "box-shadow": [/.*/],
      opacity: [/.*/],
      overflow: [/.*/],
    },
  },
  transformTags: {
    a: (tagName, attribs) => {
      const next = { ...attribs };
      if (next["href"] && /^https?:/i.test(next["href"])) {
        next["target"] = "_blank";
        const existingRel = (next["rel"] ?? "").split(/\s+/).filter(Boolean);
        const required = ["noopener", "noreferrer"];
        for (const r of required) {
          if (!existingRel.includes(r)) existingRel.push(r);
        }
        next["rel"] = existingRel.join(" ");
      }
      return { tagName, attribs: next };
    },
  },
  disallowedTagsMode: "discard",
};

/**
 * Sanitises HTML for email/preview rendering. Strips <script>, <iframe>,
 * <form>, event-handler attributes, and javascript:/vbscript: schemes;
 * keeps the inline-styled tags + linear-gradient backgrounds used by the
 * branded chrome in `seedCommTemplates.ts`.
 *
 * Defense in depth: editor authors are admins, but this sanitiser also
 * runs against pasted HTML and any future agent-authored content.
 */
export function sanitizeEmailHtml(input: string): string {
  if (!input) return "";
  return sanitizeHtml(input, EMAIL_SAFE_OPTIONS);
}
