// pptx-browser(task2 二:pptx 渲染)未携带 TS 类型,按官方 README API 手写最小垫片。
// 渲染走 canvas;destroy() 释放渲染期创建的 blob: URL(卸载/重载必调)。
declare module "pptx-browser" {
  export class PptxRenderer {
    /** load() 解析后的幻灯片总数 */
    slideCount: number;
    /** 载入 pptx(File / ArrayBuffer / Blob) */
    load(data: File | ArrayBuffer | Blob): Promise<void>;
    /** 渲染单页到目标 canvas(宽度像素;高度按幻灯片比例自动设置) */
    renderSlide(index: number, canvas: HTMLCanvasElement, width?: number): Promise<void>;
    /** 一次性渲染全部页(慎用:大 deck 内存风险;task2 二未使用,保留类型完整) */
    renderAllSlides(width?: number): Promise<HTMLCanvasElement[]>;
    /** 释放所有 blob: URL(卸载 / 换文件前调用) */
    destroy(): void;
  }
}
