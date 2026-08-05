import * as vscode from "vscode";
import { registry } from "./registry";

/**
 * Leitura tipada de workspace config. O valor atual vem sempre do VSCode;
 * o default registrado em runtime é só fallback para o caso de o manifesto
 * ainda não declarar a propriedade (ex.: testes fora do host).
 */
export function readWorkspaceConfig<T>(className: string, name: string): T {
  const value = vscode.workspace.getConfiguration(registry.prefix).get<T>(name);
  if (value !== undefined) return value;
  return registry.configDefaults.get(`${className}.${name}`) as T;
}

export function writeWorkspaceConfig<T>(className: string, name: string, value: T): Thenable<void> {
  return vscode.workspace
    .getConfiguration(registry.prefix)
    .update(name, value, vscode.ConfigurationTarget.Global);
}

/** Lê uma config pelo id completo (ex.: "hello.greeting"). */
export function getConfig<T = unknown>(id: string): T {
  const dot = id.lastIndexOf(".");
  const section = id.slice(0, dot);
  const key = id.slice(dot + 1);
  return vscode.workspace.getConfiguration(section).get<T>(key) as T;
}
