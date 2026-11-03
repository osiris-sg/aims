// Round BB — /preview/shipments/questions: the real question list (best guess, evidence, Yes / Other… / Not sure,
// batches, cards handed to the admins) from the fixture's `questions` = the Unprocessed threads answer
// ({ threads, batches, viewer }) (PREVIEW_FIXTURES=1 only, via the layout). ?lang=ja for Japanese; ?admin=1 / ?admin=0
// overrides `viewer.admin`; ?view=hidden shows "Not about a shipment" (the fixture's `hidden` rows). Nothing is sent.
import { readFileSync } from "fs";
import QuestionsPreview from "./QuestionsPreview";

export const dynamic = "force-dynamic";

export default function Page({ searchParams }: { searchParams: { admin?: string; view?: string } }) {
  const data = JSON.parse(readFileSync(process.env.PREVIEW_CLIENTS_FILE as string, "utf8"));
  const q = data.questions ?? null;
  const admin = searchParams?.admin === "1" ? true : searchParams?.admin === "0" ? false : !!q?.viewer?.admin;
  return <QuestionsPreview threads={q?.threads ?? []} batches={q?.batches ?? []} viewer={{ admin }} view={searchParams?.view === "hidden" ? "hidden" : "questions"} />;
}
