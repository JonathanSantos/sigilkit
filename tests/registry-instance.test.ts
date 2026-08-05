import { describe, expect, it } from "vitest";
import { registry } from "@sigilkit/core";

// A ponte entre classes (registry.instance): chaveada pelo CONSTRUTOR —
// minificação-safe por construção — e R6 quando a classe não é gerenciada.

describe("registry.instance — a ponte tipada entre classes", () => {
  it("devolve a instância registrada pelo wire, tipada", () => {
    class Gerenciada {
      valor = 42;
    }
    const viva = new Gerenciada();
    registry.instances.set(Gerenciada, viva);
    const got = registry.instance(Gerenciada);
    expect(got).toBe(viva);
    expect(got.valor).toBe(42); // tipado: .valor existe sem cast
  });

  it("classe não gerenciada lança erro descritivo em vez de undefined (R6)", () => {
    class Desconhecida {}
    expect(() => registry.instance(Desconhecida)).toThrow(/não é uma classe gerenciada/);
  });
});
