import { XeroClient } from "xero-node";
(async () => {
  const client = new XeroClient({
    clientId: "B421424299B64C1188D2C3E92EA60219",
    clientSecret: "jyonRzS3OPpq7PcooWQax4ZjtV3hpgDISCMGYFT661Q_NM3Q",
    redirectUris: ["http://localhost:5555/callback"],
    scopes: "offline_access accounting.transactions accounting.contacts accounting.settings accounting.attachments accounting.reports.read accounting.journals.read".split(" "),
  });
  await client.initialize();
  console.log(await client.buildConsentUrl());
})();
