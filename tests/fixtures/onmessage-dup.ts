import { Extension, OnMessage, Webview } from "@sigilkit/core";

@Extension({ prefix: "fx" })
export class Fx {}

@Webview({ id: "p", title: "P", ui: "./ui/p.html" })
export class Panel {
  @OnMessage("save")
  a(value: unknown) {}

  @OnMessage("save")
  b(value: unknown) {}
}
