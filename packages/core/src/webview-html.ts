/**
 * Transformação PURA do HTML do webview — sem vscode, sem IO — para ser
 * testável por snapshot. O webview-host injeta as partes vivas (cspSource,
 * asWebviewUri) via opções.
 */
export interface WebviewHtmlOptions {
  nonce: string;
  /** panel.webview.cspSource */
  cspSource: string;
  /** Resolve um caminho relativo ao HTML para uma URI carregável no webview. */
  resolveResource: (relativePath: string) => string;
}

const SKIP_URL = /^(https?:|data:|#|mailto:|vscode-webview:)/i;

export function renderWebviewHtml(html: string, opts: WebviewHtmlOptions): string {
  const csp =
    `default-src 'none'; ` +
    `script-src 'nonce-${opts.nonce}'; ` +
    `style-src ${opts.cspSource} 'unsafe-inline'; ` +
    `img-src ${opts.cspSource} https: data:;`;

  let out = html;

  // reescreve src/href locais via asWebviewUri
  out = out.replace(/\b(src|href)=(["'])([^"']+)\2/gi, (match, attr: string, quote: string, value: string) => {
    if (SKIP_URL.test(value)) return match;
    return `${attr}=${quote}${opts.resolveResource(value)}${quote}`;
  });

  // nonce em todo <script> que ainda não tenha um
  out = out.replace(/<script\b(?![^>]*\bnonce=)/gi, `<script nonce="${opts.nonce}"`);

  // injeta a CSP no <head> (ou prefixa, se não houver head)
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>\n  ${meta}`);
  } else {
    out = `${meta}\n${out}`;
  }
  return out;
}
