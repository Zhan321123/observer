// 零依赖的极简代码高亮(本轮"基础高亮";后续可换 shiki 真语法)。
// 关键:先在原始文本上 tokenize,再对每段分别转义,避免 &lt; 这类实体被数字/单词规则二次破坏。

const KEYWORDS = new Set([
  // js/ts
  "const","let","var","function","return","if","else","for","while","do","switch","case","break","continue",
  "class","extends","new","this","super","import","from","export","default","async","await","try","catch","finally",
  "throw","typeof","instanceof","in","of","null","undefined","true","false","void","delete","yield","static","get","set",
  "interface","type","enum","implements","namespace","declare","abstract","readonly","public","private","protected","as","satisfies",
  // rust
  "fn","mut","impl","struct","trait","pub","use","mod","match","where","self","Self","move","ref","loop","crate","dyn",
  // python
  "def","elif","lambda","pass","with","global","nonlocal","raise","assert","is","not","and","or","None","True","False","print",
  // c/c++/java/go/cs
  "int","float","double","char","long","short","unsigned","signed","sizeof","typedef","template","virtual","override",
  "package","final","boolean","byte","String","func","go","chan","defer","select","range","nil","string","bool","byte","rune",
]);

const HASH_COMMENT_LANGS = /^(py|python|sh|bash|zsh|yaml|yml|rb|pl|toml|ini|conf|cfg|makefile|mk)$/;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function highlight(code: string, lang?: string): string {
  const hashComment = !!lang && HASH_COMMENT_LANGS.test(lang.toLowerCase());
  const commentSrc = hashComment
    ? String.raw`(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)`
    : String.raw`(\/\/[^\n]*|\/\*[\s\S]*?\*\/)`;
  const re = new RegExp(
    commentSrc +
      "|" +
      String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|` +
      "`(?:[^`\\\\]|\\\\.)*`" +
      String.raw`)` +
      "|" +
      String.raw`\b(0x[\da-fA-F_]+|0b[01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b` +
      "|" +
      String.raw`\b([A-Za-z_][\w]*)\b`,
    "g"
  );

  let out = "";
  let last = 0;
  for (const m of code.matchAll(re)) {
    const idx = m.index ?? 0;
    out += escapeHtml(code.slice(last, idx));
    const [full, comment, str, num, word] = m;
    if (comment) out += `<span class="tok-c">${escapeHtml(comment)}</span>`;
    else if (str) out += `<span class="tok-s">${escapeHtml(str)}</span>`;
    else if (num) out += `<span class="tok-n">${escapeHtml(num)}</span>`;
    else if (word)
      out += KEYWORDS.has(word) ? `<span class="tok-k">${escapeHtml(word)}</span>` : escapeHtml(word);
    last = idx + full.length;
  }
  out += escapeHtml(code.slice(last));
  return out;
}
