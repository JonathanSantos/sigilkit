import ts from "typescript";

/** Carrega o ts.Node para virar diagnóstico com posição (SIGIL1001). */
export class StaticEvalError extends Error {
  constructor(
    public readonly node: ts.Node,
    message: string
  ) {
    super(message);
    this.name = "StaticEvalError";
  }
}

/**
 * Resolve um Identifier para o initializer de uma `const`. Fornecido pelo
 * coletor (usa o checker); o avaliador continua sem executar nada (R3) —
 * seguir uma const é só mais leitura de AST.
 */
export type IdentifierResolver = (id: ts.Identifier) => ts.Expression | undefined;

/**
 * Impõe a restrição de literais (§4): toda informação de identidade precisa
 * ser legível da AST sem executar código do usuário (R3). Literais, arrays e
 * objetos de literais, e — com resolver — referências a `const` cujo
 * initializer também seja literal. `as`/`satisfies`/parênteses são
 * transparentes.
 */
export function evalStatic(node: ts.Expression, resolveIdentifier?: IdentifierResolver): unknown {
  return evalNode(node, resolveIdentifier, new Set());
}

function evalNode(
  node: ts.Expression,
  resolve: IdentifierResolver | undefined,
  seen: Set<ts.Expression>
): unknown {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    return evalNode(node.expression, resolve, seen);
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return -(evalNode(node.operand, resolve, seen) as number);
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((e) => evalNode(e, resolve, seen));
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, unknown> = {};
    for (const p of node.properties) {
      if (!ts.isPropertyAssignment(p)) {
        throw new StaticEvalError(p, "spread e shorthand não são suportados aqui");
      }
      const key =
        ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : p.name.getText();
      out[key] = evalNode(p.initializer, resolve, seen);
    }
    return out;
  }
  if (ts.isIdentifier(node) && resolve) {
    const init = resolve(node);
    if (!init) {
      throw new StaticEvalError(node, "identificador precisa apontar para uma `const` com initializer literal");
    }
    if (seen.has(init)) throw new StaticEvalError(node, "referência circular de const");
    seen.add(init);
    return evalNode(init, resolve, seen);
  }
  throw new StaticEvalError(node, "o valor precisa ser um literal (ou uma const de literal)");
}
