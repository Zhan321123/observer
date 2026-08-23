import { MediaCore } from "./MediaCore";
import type { PreviewProps } from "../../formats/types";

export function VideoView(props: PreviewProps) {
  return <MediaCore {...props} isVideo />;
}
