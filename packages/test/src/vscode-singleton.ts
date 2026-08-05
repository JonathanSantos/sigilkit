/**
 * Instância COMPARTILHADA do mock, para o modo inline (sem bundle): aponte o
 * alias "vscode" do vitest para este módulo e importe o wire TS diretamente.
 * O `activateInline` (./inline) usa o MESMO estado — por isso os dois precisam
 * resolver para este arquivo (alias no vitest.config + import relativo).
 */
import { createState, createVscodeMock } from "./vscode-mock";

export const __sigilTestState = createState();

const mock = createVscodeMock(__sigilTestState) as Record<string, unknown>;

export const __mock = mock;
export const EventEmitter = mock.EventEmitter;
export const TreeItem = mock.TreeItem;
export const TreeItemCollapsibleState = mock.TreeItemCollapsibleState;
export const ViewColumn = mock.ViewColumn;
export const ConfigurationTarget = mock.ConfigurationTarget;
export const StatusBarAlignment = mock.StatusBarAlignment;
export const Position = mock.Position;
export const Range = mock.Range;
export const Selection = mock.Selection;
export const Uri = mock.Uri;
export const window = mock.window;
export const commands = mock.commands;
export const workspace = mock.workspace;
export const languages = mock.languages;
export const chat = mock.chat;
export const DiagnosticSeverity = mock.DiagnosticSeverity;
export const CompletionItemKind = mock.CompletionItemKind;
export const Hover = mock.Hover;
export const CompletionItem = mock.CompletionItem;
export const CodeLens = mock.CodeLens;
export const Diagnostic = mock.Diagnostic;
export const WorkspaceEdit = mock.WorkspaceEdit;
export const __resolveWebviewView = mock.__resolveWebviewView;
export const __fireDoc = mock.__fireDoc;
