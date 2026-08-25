// 图片 EXIF 摘要 / 色彩空间(M2,layout.md §6 文件信息框)。
// 用 exifr 解析(fetch asset:// 字节 → arrayBuffer → parse);相机/镜头/曝光/色彩空间/拍摄时间。
// 仅元数据,铁律 2 不违(EXIF 经 fetch 本地字节,非 IPC;解析失败静默回退 null)。

import exifr from "exifr";

export interface ExifSummary {
  /** 相机(Make + Model,去重) */
  camera?: string;
  /** 镜头(LensModel / LensMake) */
  lens?: string;
  /** 曝光组合:快门 · 光圈 · ISO · 焦距 */
  exposure?: string;
  /** 色彩空间(sRGB / Adobe RGB / …) */
  colorSpace?: string;
  /** 拍摄时间(unix 秒) */
  takenAt?: number;
}

/** 快门秒数 → 可读("1/125s" 或 "2s") */
function fmtShutter(sec: unknown): string | null {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return null;
  return s >= 1 ? `${Math.round(s * 10) / 10}s` : `1/${Math.round(1 / s)}s`;
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** EXIF ColorSpace 标签 → 可读(兼容数字/字符串;ICC 侧另看 ProfileDescription) */
function fmtColorSpace(data: Record<string, unknown>): string | undefined {
  const cs = data.ColorSpace;
  if (typeof cs === "number") {
    if (cs === 1) return "sRGB";
    if (cs === 2) return "Adobe RGB";
    if (cs === 0xffff || cs === 65535) return undefined; // Uncalibrated 不显示
  }
  const s = str(cs);
  if (s && !/uncalibrated/i.test(s)) return s;
  // ICC profile 描述兜底
  return str(data.ProfileDescription) ?? undefined;
}

/** 解析图片文件的 EXIF 摘要;无 EXIF / 解析失败 → null。url 为 asset:// 地址。 */
export async function readExif(url: string): Promise<ExifSummary | null> {
  let buf: ArrayBuffer;
  try {
    buf = await fetch(url).then((r) => r.arrayBuffer());
  } catch {
    return null;
  }
  let data: Record<string, unknown> | null;
  try {
    // icc:true 取色彩 profile;sanitize 去掉二进制大字段
    data = (await exifr.parse(buf, { icc: true, sanitize: true })) as Record<string, unknown> | null;
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;

  const make = str(data.Make);
  const model = str(data.Model);
  // Model 常已含 Make(如 "Canon EOS R5"),去重拼接
  const camera =
    make && model
      ? model.toLowerCase().startsWith(make.toLowerCase())
        ? model
        : `${make} ${model}`
      : (model ?? make ?? undefined);

  const lens = str(data.LensModel) ?? str(data.LensMake) ?? undefined;

  const expoParts: string[] = [];
  const shutter = fmtShutter(data.ExposureTime);
  if (shutter) expoParts.push(shutter);
  const fnum = Number(data.FNumber);
  if (Number.isFinite(fnum) && fnum > 0) expoParts.push(`f/${Math.round(fnum * 10) / 10}`);
  const iso = Number(data.ISO ?? data.ISOSpeedRatings);
  if (Number.isFinite(iso) && iso > 0) expoParts.push(`ISO ${Math.round(iso)}`);
  const focal = Number(data.FocalLength);
  if (Number.isFinite(focal) && focal > 0) expoParts.push(`${Math.round(focal)}mm`);
  const exposure = expoParts.length ? expoParts.join(" · ") : undefined;

  const colorSpace = fmtColorSpace(data);

  let takenAt: number | undefined;
  const dto = data.DateTimeOriginal ?? data.CreateDate;
  if (dto instanceof Date && !Number.isNaN(dto.getTime())) takenAt = Math.floor(dto.getTime() / 1000);

  const summary: ExifSummary = { camera, lens, exposure, colorSpace, takenAt };
  return Object.values(summary).some((v) => v != null) ? summary : null;
}
