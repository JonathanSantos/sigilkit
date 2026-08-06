import { Extension, Webview, ContextKey } from "@sigilkit/core";

@Extension({ prefix: "fx" })
export class Fx {
  @ContextKey()
  accessor modo = "painel";
}

@Webview({ id: "v", title: "V", ui: "./ui/v.html", location: "sidebar", when: "fx.modoo == 'explorer'" })
export class V {}
