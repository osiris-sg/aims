import { marked } from "marked";

export default function markdownToHtml(markdown: string): Promise<string> | string {
  if (!markdown) return "";
  return marked.parse(markdown);
}
