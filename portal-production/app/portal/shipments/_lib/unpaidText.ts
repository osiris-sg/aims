// Round BQ — the Unpaid list's reason / note texts come from the API in English ("step 6 not done", "estimate
// (step 7)"); in Japanese they are translated here, piece by piece. Unknown text is shown as it came.

const JA: Array<[RegExp, string | ((...m: string[]) => string)]> = [
  [/^step (\d+) not done$/, (_, n) => `ステップ${n}未完了`],
  [/^step (\d+) not done \(in progress\)$/, (_, n) => `ステップ${n}未完了（進行中）`],
  [/^step (\d+) not done \(no receipt recorded\)$/, (_, n) => `ステップ${n}未完了（入金記録なし）`],
  [/^step (\d+) not done \((#.+)\)$/, (_, n, refs) => `ステップ${n}未完了（${refs}）`],
  [/^no receipt recorded$/, "入金記録なし"],
  [/^a CI payment proof is filed — check step 6$/, "CI支払証憑あり — ステップ6を確認"],
  [/^invoice (.+)$/, (_, no) => `請求書 ${no}`],
  [/^PI deposit$/, "PI前払金"],
  [/^CI (.+) − deposit paid (.+)$/, (_, ci, dep) => `CI ${ci} − 支払済み前払金 ${dep}`],
  [/^full CI \(deposit not paid yet\)$/, "CI全額（前払金未払い）"],
  [/^CI balance$/, "CI残額"],
  [/^CI amount not in yet$/, "CI金額未確定"],
  [/^import permit \(actual\)$/, "輸入許可書（実額）"],
  [/^import permit filed — its total is not read yet \(step 10\)$/, "輸入許可書あり — 金額未読取（ステップ10）"],
  [/^estimate \(step 7\)$/, "見積（ステップ7）"],
  [/^no estimate yet \(needs the CIF and FX on step 7\)$/, "見積なし（ステップ7のCIF・為替が必要）"],
  [/^shared bill \((\d+) shipments\)$/, (_, n) => `共通請求（${n}件の出荷）`],
  [/^invoice not read yet$/, "請求書未読取"],
  [/^filed PDF$/, "PDF請求書"],
  [/^AIMS invoice$/, "AIMS請求書"],
  [/^paid with the next invoice$/, "次回請求分と合算"],
  [/^paid with (.+)$/, (_, inv) => `${inv} と合算`],
  [/^pay with the next invoice$/, "次回請求分と合算"],
];

/** A reason / note in the UI language ("step 6 not done · a CI payment proof is filed — check step 6"). */
export function unpaidText(s: string | null | undefined, lang: string): string {
  if (!s) return "";
  if (lang !== "ja") return s;
  return s
    .split(" · ")
    .map((part) => {
      for (const [re, to] of JA) {
        const m = re.exec(part);
        if (m) return typeof to === "string" ? to : to(...m);
      }
      return part;
    })
    .join(" · ");
}
