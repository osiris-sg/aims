"use client";

import ComingSoon from "../_lib/ComingSoon";

export default function ForeignBankPage() {
  return (
    <ComingSoon
      title="Foreign Bank Listing"
      description="Foreign-currency bank balances with exchange rate revaluation."
      bullets={[
        "List of bank accounts in non-base currencies (e.g. USD, JPY)",
        "Foreign balance vs. base-currency balance",
        "Period-end FX revaluation utility",
        "Exchange gain / loss journal posting",
      ]}
    />
  );
}
