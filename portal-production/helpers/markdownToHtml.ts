import { marked } from "marked";

export default function markdownToHtml(markdown: string): string {
  if (!markdown) return "";
  return marked.parse(markdown);
}
