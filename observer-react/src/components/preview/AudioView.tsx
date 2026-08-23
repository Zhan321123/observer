import { MediaCore } from "./MediaCore";
import type { PreviewProps } from "../../formats/types";

export function AudioView(props: PreviewProps) {
  return <MediaCore {...props} isVideo={false} />;
}
