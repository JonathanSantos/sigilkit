import { describe, expect, it } from "vitest";
import { renderWebviewHtml } from "../packages/core/src/webview-html";

// O shell HTML é uma função pura (as partes vivas — cspSource, asWebviewUri —
// entram por injeção), então testa sem vscode e sem extension host.

const opts = {
  nonce: "NONCE123",
  cspSource: "https://csp.example",
  resolveResource: (rel: string) => `resolved:${rel}`,
};

describe("shell HTML do webview (§15.2)", () => {
  it("injeta a CSP no <head> com nonce e cspSource", () => {
    const out = renderWebviewHtml("<html><head><title>x</title></head><body></body></html>", opts);
    expect(out).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(out).toContain("default-src 'none'");
    expect(out).toContain("script-src 'nonce-NONCE123'");
    expect(out).toContain("style-src https://csp.example 'unsafe-inline'");
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("<title>"));
  });

  it("prefixa a CSP quando não há <head>", () => {
    const out = renderWebviewHtml("<p>oi</p>", opts);
    expect(out.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
  });

  it("adiciona nonce a <script> sem nonce e preserva nonce existente", () => {
    const out = renderWebviewHtml('<script>a()</script><script nonce="own">b()</script>', opts);
    expect(out).toContain('<script nonce="NONCE123">a()');
    expect(out).toContain('<script nonce="own">b()');
  });

  it("reescreve src/href locais e não toca em https/data/âncora", () => {
    const html = [
      '<img src="img/logo.png">',
      '<link href="style.css" rel="stylesheet">',
      '<img src="https://x/y.png">',
      '<img src="data:image/png;base64,AA">',
      '<a href="#section">âncora</a>',
    ].join("\n");
    const out = renderWebviewHtml(html, opts);
    expect(out).toContain('src="resolved:img/logo.png"');
    expect(out).toContain('href="resolved:style.css"');
    expect(out).toContain('src="https://x/y.png"');
    expect(out).toContain('src="data:image/png;base64,AA"');
    expect(out).toContain('href="#section"');
  });

  it("snapshot do shell completo", () => {
    const html = `<!DOCTYPE html>
<html><head><title>t</title></head>
<body><img src="a.png"><script>go()</script></body></html>`;
    expect(renderWebviewHtml(html, opts)).toMatchSnapshot();
  });
});
