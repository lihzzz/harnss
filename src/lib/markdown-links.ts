import { defaultUrlTransform, type UrlTransform } from "react-markdown";
import { parseLocalFileLink } from "@shared/lib/file-paths";

/** Only anchors can open local files through the explicit editor IPC handler. */
export const markdownUrlTransform: UrlTransform = (url, key, node) => {
  if (key === "href" && node.tagName === "a" && parseLocalFileLink(url)) return url;
  return defaultUrlTransform(url);
};
