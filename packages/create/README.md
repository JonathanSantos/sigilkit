# create-sigil

A porta de entrada do [sigil](https://github.com/JonathanSantos/sigilkit):

```bash
npm create sigil minha-extensao
# ou, com o painel React de protocolo tipado:
npm create sigil minha-extensao -- --template=react-webview
```

Gera um projeto de extensão do VSCode com o manifesto derivado do TypeScript.
Depois: `cd minha-extensao && npm install && npm run build` — e `npx sigil sim
--ui .` para vê-la rodando num workbench no browser, sem abrir o VSCode.
