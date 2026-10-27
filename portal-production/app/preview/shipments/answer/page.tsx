// Round AR — /preview/shipments/answer: the Answer flow (several shipments, a target per file, a general issue) from the
// fixture's `answer.thread` (PREVIEW_FIXTURES=1 only, via the layout). ?lang=ja for Japanese. Nothing is sent.
import { readFileSync } from "fs";
import AnswerPreview from "./AnswerPreview";

export const dynamic = "force-dynamic";

export default function Page({ searchParams }: { searchParams: { lang?: string } }) {
  const data = JSON.parse(readFileSync(process.env.PREVIEW_CLIENTS_FILE as string, "utf8"));
  return <AnswerPreview thread={data.answer?.thread ?? null} lang={searchParams?.lang === "ja" ? "ja" : "en"} />;
}
