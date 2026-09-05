/**
 * 文本字节解码 + 分隔文本解析。
 * 说明:常规文本(含 csv/tsv)已统一走后端 read_text_file(chardetng 编码探测,GBK
 * 等不乱码);decodeTextBytes 仅剩 DXF(threeLoader 自取字节)在用。
 */

/** 字节 → 文本:优先 UTF-8(严格),失败回退 GB18030(覆盖 GBK,中文 Windows 默认)。去 BOM。 */
export function decodeTextBytes(buf: ArrayBuffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder("gb18030").decode(buf);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * RFC4180 分隔文本解析:处理引号包裹、双引号转义("")、字段内换行。
 * 返回二维字符串数组(不截断,截断由渲染层 DataTable 负责)。
 */
export function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let started = false; // 当前行是否已有内容(区分空行与末尾空字段)

  const pushField = () => {
    row.push(field);
    field = "";
    started = true;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      pushField();
    } else if (c === "\n") {
      pushRow();
    } else if (c === "\r") {
      // 忽略,\n 处统一结算
    } else {
      field += c;
    }
  }
  // 末尾:有残留字段/行则收尾(避免末尾空行多出一行)
  if (field !== "" || started || row.length > 0) pushRow();
  return rows;
}
