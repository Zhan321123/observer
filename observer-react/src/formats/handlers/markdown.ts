import type { FormatHandler } from "../types";
import { TextView } from "../../components/preview/TextView";

export const markdownHandler: FormatHandler = {
  name: "markdown",
  exts: ["md", "markdown", "mdown", "mkd"],
  canHandle: (f) => f.kind === "markdown",
  resolve: () => ({ kind: "markdown", strategy: "native", component: TextView }),
};
