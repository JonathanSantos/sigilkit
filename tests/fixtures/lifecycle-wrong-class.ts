import { Extension, Command, Language, Hover, OnOpen, Every, log } from "@sigilkit/core";

@Extension({ prefix: "fix" })
export class Fix {
  @Command({ title: "Ping" })
  ping() {
    log.info("pong");
  }

  @OnOpen
  aoAbrir() {} // linha 10: @OnOpen numa @Extension é ignorado — SIGIL1022
}

@Language({ id: "markdown" })
export class Lang {
  @Hover()
  hover() {
    return undefined;
  }

  @Every(1000)
  tique() {} // linha 21: @Every numa @Language é ignorado — SIGIL1022
}
