// 分卷压缩识别(task2 §6,本轮整体暂缓)。
// 分卷 = 一个逻辑压缩包的字节被拆成多个文件(a.part1.rar+a.part2.rar、a.7z.001+a.7z.002、
// a.zip+a.z01)。读时应从首卷打开、各卷接力;缺任一卷即失败 —— 本轮不做,只做识别:
// - 尾卷(非首卷)→ 文件树隐藏(当不可预览文件,避免误开半个包);
// - 首卷 → 可见,预览时给"分卷压缩,暂不支持"占位。

/** 尾卷(非首卷成员):.z01-.z99 / .r00+ / .partN.rar(N≥2) / .7z.NNN(N≥2) */
export function isSplitTail(name: string): boolean {
  const n = name.toLowerCase();
  // zip 分卷尾:.z01 … .z99
  if (/\.z\d{2}$/.test(n)) return true;
  // rar 旧式尾卷:.r00 …
  if (/\.r\d{2,}$/.test(n)) return true;
  // rar 新式:.part2.rar / .part02.rar …(首卷 part1 由 isSplitFirstVolume 判)
  const m = /\.part(\d+)\.rar$/.exec(n);
  if (m && parseInt(m[1], 10) > 1) return true;
  // 7z 分卷尾:.7z.002 …(首卷 .7z.001 由 isSplitFirstVolume 判)
  const s = /\.7z\.(\d{3})$/.exec(n);
  if (s && parseInt(s[1], 10) > 1) return true;
  return false;
}

/** 分卷首卷:.part1.rar(含 .part01.rar 前导零)/ .7z.001 —— 可见,预览时占位提示暂不支持 */
export function isSplitFirstVolume(name: string): boolean {
  const n = name.toLowerCase();
  return /\.part0*1\.rar$/.test(n) || /\.7z\.001$/.test(n);
}
