import * as vscode from "vscode";
import { registry } from "./registry";

function contextOrThrow(): vscode.ExtensionContext {
  if (!registry.context) {
    throw new Error(
      "sigil: resources usado fora do ciclo de ativação — o wire gerado define registry.context no início do activate()"
    );
  }
  return registry.context;
}

/**
 * Recursos empacotados com a extensão (media/, ui/, data/…), lidos de forma
 * web-ready via workspace.fs — o mesmo código funciona no vscode.dev.
 * Caminhos relativos à raiz da extensão.
 */
export const resources = {
  uri(relativePath: string): vscode.Uri {
    return vscode.Uri.joinPath(contextOrThrow().extensionUri, relativePath);
  },
  async readBytes(relativePath: string): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(resources.uri(relativePath));
  },
  async readText(relativePath: string): Promise<string> {
    return new TextDecoder().decode(await resources.readBytes(relativePath));
  },
  async readJson<T = unknown>(relativePath: string): Promise<T> {
    return JSON.parse(await resources.readText(relativePath)) as T;
  },
};
