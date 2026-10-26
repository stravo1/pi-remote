import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown } from "../src/markdown.ts";

test("renders common markdown", () => {
  const html = renderMarkdown("# Title\n\n**bold** and `code`\n\n- one\n- two\n\n```ts\nconst a = 1;\n```");
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<li>one<\/li>/);
  assert.match(html, /<span class="hljs-keyword">const<\/span>/);
});

test("escapes raw HTML", () => {
  const html = renderMarkdown("<script>alert(1)</script> <img src=x onerror=alert(1)>");
  assert.doesNotMatch(html, /<script|<img/);
  assert.match(html, /&lt;script&gt;/);
});

test("keeps only http, https, and mailto links and opens them safely", () => {
  assert.match(
    renderMarkdown("[ok](https://example.com)"),
    /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">ok<\/a>/,
  );
  assert.doesNotMatch(renderMarkdown("[bad](javascript:alert(1))"), /<a /);
  assert.doesNotMatch(renderMarkdown("[bad](data:text/html;base64,AAAA)"), /<a /);
});

test("never loads images", () => {
  const html = renderMarkdown("![tracker](https://evil.example/pixel.png)");
  assert.doesNotMatch(html, /<img|evil\.example/);
  assert.match(html, /tracker/);
});

test("handles unfinished markdown while a reply streams", () => {
  assert.doesNotThrow(() => renderMarkdown("```ts\nconst a ="));
  assert.doesNotThrow(() => renderMarkdown("**half"));
});

test("escapes unknown code languages and highlights without allowing HTML", () => {
  assert.match(renderMarkdown('```unknown\n<img onerror="evil()">\n```'), /&lt;img/);
  assert.doesNotMatch(renderMarkdown("```html\n<script>alert(1)</script>\n```"), /<script/);
  assert.doesNotMatch(renderMarkdown('```x" onmouseover="evil\nhello\n```'), /onmouseover/);
});
