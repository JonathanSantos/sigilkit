import ts from "typescript";
import path from "node:path";
import { SourceLoc } from "./ir";

/** Códigos semânticos do sigil (§9 do spec). */
export const SIGIL = {
  /** nenhuma classe @Extension no projeto (ou classe sem nome) */
  NoExtension: 1000,
  /** argumento de decorator não é literal estático */
  NotStaticLiteral: 1001,
  /** id de comando duplicado */
  DuplicateCommandId: 1002,
  /** id de config duplicado */
  DuplicateConfigId: 1003,
  /** @Watch referencia config inexistente */
  WatchUnknownConfig: 1004,
  /** keybinding duplicado dentro da extensão */
  DuplicateKeybinding: 1005,
  /** @Config em propriedade sem accessor */
  ConfigWithoutAccessor: 1006,
  /** tipo de config não suportado */
  UnsupportedConfigType: 1007,
  /** membro decorado em classe sem @Extension */
  DecoratedOutsideExtension: 1008,
  /** mais de uma classe @Extension no projeto */
  MultipleExtensionClasses: 1009,
  /** @Command sem title */
  CommandWithoutTitle: 1010,
  /** @Config sem valor default literal */
  ConfigWithoutDefault: 1011,
  /** @TreeView sem @TreeRoot/@TreeItem, ou marcador duplicado */
  TreeViewIncomplete: 1012,
  /** id de view/webview duplicado */
  DuplicateViewId: 1013,
  /** decorator de membro incompatível com o tipo da classe */
  WrongClassForMember: 1014,
  /** tipo de mensagem duplicado em @OnMessage */
  DuplicateMessageType: 1015,
  /** opção obrigatória ausente em decorator */
  MissingRequiredOption: 1016,
  /** referência a comando inexistente (ex.: command de @StatusBar) */
  UnknownCommandReference: 1017,
} as const;

export function diagAt(node: ts.Node, code: number, message: string): ts.Diagnostic {
  return {
    category: ts.DiagnosticCategory.Error,
    code,
    file: node.getSourceFile(),
    start: node.getStart(),
    length: node.getWidth(),
    messageText: `[SIGIL${code}] ${message}`,
    source: "sigil",
  };
}

export function diagGlobal(code: number, message: string): ts.Diagnostic {
  return {
    category: ts.DiagnosticCategory.Error,
    code,
    file: undefined,
    start: undefined,
    length: undefined,
    messageText: `[SIGIL${code}] ${message}`,
    source: "sigil",
  };
}

/** Reconstrói um diagnóstico posicionado a partir de um SourceLoc do IR. */
export function diagAtLoc(
  program: ts.Program,
  projectDir: string,
  loc: SourceLoc,
  code: number,
  message: string
): ts.Diagnostic {
  const fileName = path.resolve(projectDir, loc.file);
  const file =
    program.getSourceFile(fileName) ?? program.getSourceFile(fileName.split(path.sep).join("/"));
  if (!file) return diagGlobal(code, `${message} (${loc.file}:${loc.line})`);
  const start = file.getPositionOfLineAndCharacter(loc.line - 1, loc.character - 1);
  return {
    category: ts.DiagnosticCategory.Error,
    code,
    file,
    start,
    length: 1,
    messageText: `[SIGIL${code}] ${message}`,
    source: "sigil",
  };
}

const formatHost: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: (f) => f,
  getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
  getNewLine: () => ts.sys.newLine,
};

/** Formatação com caret apontando para o token errado (§9). */
export function formatDiagnostics(diags: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnosticsWithColorAndContext(diags, formatHost);
}
