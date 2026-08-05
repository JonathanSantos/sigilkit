# Hello (exemplo sigil)

Extensão de exemplo do framework sigil — nenhuma linha de `contributes` é
escrita à mão: comandos, configs, keybinding, tree view, webview e status bar
são derivados dos decorators em `src/extension.ts`.

```bash
npm run build      # sigil build (manifesto + wire) + esbuild (bundle)
npm run package    # gera o .vsix instalável
```

Abra esta pasta no VSCode e aperte F5 para rodar.
