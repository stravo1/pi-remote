import { Marked, type Tokens } from "marked";

const safeLink = /^(https?:|mailto:)/i;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
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
