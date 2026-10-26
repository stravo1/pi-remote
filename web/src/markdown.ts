import { Marked, type Tokens } from "marked";

import highlight from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import diff from "highlight.js/lib/languages/diff";
import sql from "highlight.js/lib/languages/sql";
import yaml from "highlight.js/lib/languages/yaml";

for (const [name, language] of Object.entries({ javascript, typescript, python, bash, json, css, xml, diff, sql, yaml })) {
  highlight.registerLanguage(name, language);
}

const safeLink = /^(https?:|mailto:)/i;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }: Tokens.Code) {
      const language = lang?.split(/\s/)[0] ?? "";
      const html = highlight.getLanguage(language)
        ? highlight.highlight(text, { language, ignoreIllegals: true }).value : escapeHtml(text);
      return `<pre><code class="hljs">${html}</code></pre>`;
    },
    html: ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text),
    image: ({ text }: Tokens.Image) => escapeHtml(text),
    link({ href, tokens }: Tokens.Link) {
      const label = this.parser.parseInline(tokens);
      if (!safeLink.test(href)) return label;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    },
  },
});

export function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false });
}
