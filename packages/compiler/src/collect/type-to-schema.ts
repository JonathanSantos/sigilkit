import ts from "typescript";

export interface SchemaInfo {
  jsonType: "string" | "number" | "boolean" | "array" | "object";
  tsType: string;
  enum?: string[];
  items?: { type: string };
}

/**
 * Inferência de schema a partir do TypeNode da propriedade (§8.3).
 * Retorna undefined para tipo não suportado (vira SIGIL1007 no coletor).
 *
 * Com o `checker`, aliases e tipos derivados também funcionam
 * (`accessor petType: PetType` onde `type PetType = "dog" | "fox"`, ou
 * uniões vindas de keyof/indexed access): o tipo RESOLVIDO é que decide.
 * O tsType emitido usa a união expandida — o nome do alias não existiria
 * no config.d.ts gerado.
 */
export function typeNodeToSchema(typeNode: ts.TypeNode, checker?: ts.TypeChecker): SchemaInfo | undefined {
  switch (typeNode.kind) {
    case ts.SyntaxKind.StringKeyword:
      return { jsonType: "string", tsType: "string" };
    case ts.SyntaxKind.NumberKeyword:
      return { jsonType: "number", tsType: "number" };
    case ts.SyntaxKind.BooleanKeyword:
      return { jsonType: "boolean", tsType: "boolean" };
  }

  if (ts.isParenthesizedTypeNode(typeNode)) return typeNodeToSchema(typeNode.type);

  if (ts.isArrayTypeNode(typeNode)) {
    const el = typeNodeToSchema(typeNode.elementType);
    // apenas arrays de primitivos por enquanto
    if (!el || el.jsonType === "array" || el.jsonType === "object") return undefined;
    return { jsonType: "array", tsType: `${el.tsType}[]`, items: { type: el.jsonType } };
  }

  if (ts.isUnionTypeNode(typeNode)) {
    const values: string[] = [];
    for (const member of typeNode.types) {
      if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) {
        values.push(member.literal.text);
      } else {
        return undefined;
      }
    }
    return { jsonType: "string", tsType: typeNode.getText(), enum: values };
  }

  if (ts.isTypeLiteralNode(typeNode)) {
    return { jsonType: "object", tsType: typeNode.getText() };
  }

  // último recurso: resolver o tipo de verdade (aliases, keyof, indexed access)
  if (checker) {
    return resolvedTypeToSchema(checker.getTypeFromTypeNode(typeNode));
  }
  return undefined;
}

function resolvedTypeToSchema(type: ts.Type): SchemaInfo | undefined {
  if (type.flags & ts.TypeFlags.Boolean) return { jsonType: "boolean", tsType: "boolean" };
  if (type.flags & ts.TypeFlags.String) return { jsonType: "string", tsType: "string" };
  if (type.flags & ts.TypeFlags.Number) return { jsonType: "number", tsType: "number" };
  if (type.isUnion()) {
    const values: string[] = [];
    for (const member of type.types) {
      if (member.isStringLiteral()) values.push(member.value);
      else return undefined;
    }
    return {
      jsonType: "string",
      tsType: values.map((v) => JSON.stringify(v)).join(" | "),
      enum: values,
    };
  }
  return undefined;
}

/** Fallback quando a propriedade não tem anotação de tipo: infere do default literal. */
export function schemaFromValue(v: unknown): SchemaInfo | undefined {
  switch (typeof v) {
    case "string":
      return { jsonType: "string", tsType: "string" };
    case "number":
      return { jsonType: "number", tsType: "number" };
    case "boolean":
      return { jsonType: "boolean", tsType: "boolean" };
  }
  if (Array.isArray(v)) {
    const el = v.length > 0 ? schemaFromValue(v[0]) : undefined;
    if (el && el.jsonType !== "array" && el.jsonType !== "object") {
      return { jsonType: "array", tsType: `${el.tsType}[]`, items: { type: el.jsonType } };
    }
    return { jsonType: "array", tsType: "unknown[]" };
  }
  return undefined;
}
