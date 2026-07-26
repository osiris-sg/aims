import { marked } from "marked";

export default function markdownToHtml(markdown: string): string {
  if (!markdown) return "";
  // async: false pins the sync overload — marked's default types otherwise
  // return string | Promise<string>, which breaks dangerouslySetInnerHTML.
  return marked.parse(markdown, { async: false }) as string;
}
