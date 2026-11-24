# Making the file bucket private (security phase 4)

Bucket: `aims-osiris` (region `ap-southeast-1`). Dev and prod share it.
Today it is publicly readable through a **bucket policy** statement (not object
ACLs). Phases 0-3 (2026-11-24) moved the app to org-checked signed links, so the
public statement can go once the checks below pass.

Needs an AWS user/role with bucket admin rights (`s3:GetBucketPolicy`,
`s3:PutBucketPolicy`, `s3:PutBucketVersioning`, `s3:PutLifecycleConfiguration`,
`s3:PutBucketPublicAccessBlock`). The app's own keys do not have these.
Replace nothing below except where it says so; no account ids are needed.

---

## A. Do now: turn on versioning (protects against overwrites and deletes)

Versioning keeps the old copy whenever an object is overwritten or deleted.
It is off today ("never enabled", checked 2026-11-24).

### Console
1. S3 -> Buckets -> `aims-osiris` -> **Properties**.
2. **Bucket Versioning** -> Edit -> **Enable** -> Save changes.
3. (Optional, keeps the cost down) **Management** -> **Create lifecycle rule**:
   - Name: `expire-old-versions-90d`, scope: **Apply to all objects**, tick the acknowledgement.
   - Actions: tick **Permanently delete noncurrent versions of objects**; Days after objects become noncurrent: `90`.
   - Also tick **Delete expired object delete markers or incomplete multipart uploads**; incomplete multipart uploads: `7` days.
   - Create rule.

### aws-cli
```bash
aws s3api put-bucket-versioning --bucket aims-osiris --versioning-configuration Status=Enabled
aws s3api get-bucket-versioning --bucket aims-osiris          # expect "Status": "Enabled"

cat > /tmp/lifecycle.json <<'JSON'
{ "Rules": [ {
  "ID": "expire-old-versions-90d", "Status": "Enabled", "Filter": {},
  "NoncurrentVersionExpiration": { "NoncurrentDays": 90 },
  "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
} ] }
JSON
aws s3api put-bucket-lifecycle-configuration --bucket aims-osiris --lifecycle-configuration file:///tmp/lifecycle.json
aws s3api get-bucket-lifecycle-configuration --bucket aims-osiris
```
If the bucket already has lifecycle rules, `get-bucket-lifecycle-configuration`
first and add this rule to the existing list (the put replaces the whole set).

Optional but recommended for forensics later: **Properties -> Server access
logging -> Enable**, target a separate log bucket (for example
`aims-osiris-logs`, private). Access logging is off today.

---

## B. Only after phases 1-3 are live and checked: remove public read

### Pre-checks (all must pass first)
1. `https://app.ai-ms.io/api/version` and `https://aims-ahwy.onrender.com/health`
   show the phase 3 commit (`2893d759` or later).
2. The StoredFile backfill has been applied on prod
   (`scripts/_sec-storedfile-backfill.ts --prod --apply --confirm-prod`, see its dry run).
3. Logged in, these show their images/files: a delivery with photos, a service
   report (signatures + photos), Settings -> Company profile (logo, PayNow QR), an
   asset image, a vehicle log attachment, a project cost attachment, a lead
   attachment, a document PDF preview/download.
4. Without logging in, these show their logo / photos: a guest delivery link, a
   guest DO link, a pay link, a quotation sign link, a service-report sign link.
5. In the browser dev tools Network tab on those pages, no image is loaded from
   `aims-osiris.s3...amazonaws.com/<key>` WITHOUT `X-Amz-Signature` in the URL.
6. Known gap to settle first: the SiteClock worker app (separate app) shows AIMS
   photos by key? If it builds public bucket URLs itself, it must switch to
   signed links before this step.

### 1. View the current policy (and keep a copy for rollback)
Console: Buckets -> `aims-osiris` -> **Permissions** -> **Bucket policy** -> copy the JSON somewhere safe.

```bash
aws s3api get-bucket-policy --bucket aims-osiris --query Policy --output text > aims-osiris-policy-backup.json
cat aims-osiris-policy-backup.json
```

### 2. Delete the public-read statement
Find the statement that looks like this (the Sid may differ):
```json
{
  "Sid": "PublicReadGetObject",
  "Effect": "Allow",
  "Principal": "*",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::aims-osiris/*"
}
```
That is: `"Effect": "Allow"`, `"Principal": "*"` (or `{"AWS": "*"}`), action
`s3:GetObject`, resource `arn:aws:s3:::aims-osiris/*`, with no `Condition`.
Delete ONLY that statement; keep every other statement as it is.

- Console: Permissions -> Bucket policy -> Edit -> remove that statement (mind the commas) -> Save.
  If it was the only statement, use **Delete** on the policy instead.
- aws-cli: edit a copy without that statement and put it back:
  ```bash
  cp aims-osiris-policy-backup.json aims-osiris-policy-new.json   # then delete the statement in an editor
  aws s3api put-bucket-policy --bucket aims-osiris --policy file://aims-osiris-policy-new.json
  # or, if it was the only statement:
  aws s3api delete-bucket-policy --bucket aims-osiris
  ```

### 3. Turn on Block Public Access (bucket level)
Console: Permissions -> **Block public access (bucket settings)** -> Edit -> tick
**Block all public access** -> Save -> type `confirm`.

```bash
aws s3api put-public-access-block --bucket aims-osiris \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api get-public-access-block --bucket aims-osiris
```
(Do step 2 first: with BlockPublicPolicy on, a policy that still grants public access is refused.)

Presigned URLs keep working: they are signed by the app's IAM user, which is not "public".

### 4. Verify
Anonymous (expect **403**):
```bash
curl -sI https://aims-osiris.s3.ap-southeast-1.amazonaws.com/logos/wct-logo.png | head -1
```
App, no session (expect **401**):
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://app.ai-ms.io/api/f/logos/wct-logo.png
```
App, logged in (expect **200** after the redirect): open
`https://app.ai-ms.io/api/f/logos/wct-logo.png` in a logged-in browser tab of a
WCT user, then repeat pre-checks 3 and 4.

### 5. FILES_STRICT: not used (owner, 2026-11-25)
Leave `FILES_STRICT` off (0 or unset). Strict mode would only block files with no
recorded owner; every WCT group file has one, and turning it on (24 Nov) would have
blocked 1,106 older Biofuel / DEMO / Osiris files. Dropped from the plan.

---

## Rollback
If files stop showing after step 2/3:
1. Turn Block Public Access off again:
   ```bash
   aws s3api delete-public-access-block --bucket aims-osiris
   ```
   (Console: Permissions -> Block public access -> Edit -> untick all -> Save.)
2. Put the saved policy back:
   ```bash
   aws s3api put-bucket-policy --bucket aims-osiris --policy file://aims-osiris-policy-backup.json
   ```
3. Check the anonymous curl returns 200 again, then find the page that broke
   (Network tab: the failing image URL) before trying again.
Versioning (part A) is never rolled back: suspending it is allowed but keeps old versions.
