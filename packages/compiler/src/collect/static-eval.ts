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
 * Impõe a restrição de literais (§4): toda informação de identidade precisa
 * ser legível da AST sem executar código do usuário (R3).
 */
export function evalStatic(node: ts.Expression): unknown {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return -(evalStatic(node.operand) as number);
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(evalStatic);
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, unknown> = {};
    for (const p of node.properties) {
      if (!ts.isPropertyAssignment(p)) {
        throw new StaticEvalError(p, "spread e shorthand não são suportados aqui");
      }
      const key =
        ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : p.name.getText();
      out[key] = evalStatic(p.initializer);
    }
    return out;
  }
  throw new StaticEvalError(node, "o valor precisa ser um literal");
}
