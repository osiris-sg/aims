"use client";

// Email a report's PDF — the sales documents' compose dialog
// (app/portal/invoices/components/SendInvoiceEmailDialog) carried over to
// reports (guru 2026-11-11: "add the email function at the bottom of Print,
// take that code from how we have it under sales documents"). Same fields
// (FROM, TO chips, CC/BCC, attachment, subject, message) and the same
// translations; the attachment is the report's own PDF, posted base64 to
// /statements/report/send-email.

import React, { useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import SendIcon from "@mui/icons-material/Send";
import AddIcon from "@mui/icons-material/Add";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";
import { reportPdfBase64, reportPdfFilename, type ReportExportModel } from "./report-export";

const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export default function SendReportEmailDialog({
  open,
  model,
  onClose,
}: {
  open: boolean;
  model: ReportExportModel | null;
  onClose: () => void;
}) {
  const t = useTranslations("invoices.sendEmail");
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [newCcEmail, setNewCcEmail] = useState("");
  const [newBccEmail, setNewBccEmail] = useState("");

  const title = model?.title || "Report";
  const orgName = model?.orgName || "";
  const filename = model ? reportPdfFilename(model) : "report.pdf";

  useEffect(() => {
    if (!open || !model) return;
    setError(null);
    setTo(model.emailTo?.filter(validateEmail) || []);
    setCc([]);
    setBcc([]);
    setNewCcEmail("");
    setNewBccEmail("");
    const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    setSubject(`${title}${orgName ? ` from ${orgName}` : ""} — ${today}`);
    const meta = (model.metaLines || []).filter(Boolean).join("; ");
    setMessage(`Hi,

Please find attached the ${title}${meta ? ` (${meta})` : ""}.

If you have any questions, please don't hesitate to contact us.

Best regards,
${orgName}`);
  }, [open, model, title, orgName]);

  const addTo = (list: string[], set: (v: string[]) => void, value: string, clear: () => void, dupKey: "alreadyCc" | "alreadyBcc") => {
    if (value && validateEmail(value)) {
      if (list.includes(value)) toast.warning(t(dupKey));
      else {
        set([...list, value]);
        clear();
      }
    } else toast.error(t("validEmail"));
  };

  const handleSend = async () => {
    if (!model) return;
    if (!to.length) return void toast.error(t("toRequired"));
    if (!subject.trim()) return void toast.error(t("subjectRequired"));
    if (!message.trim()) return void toast.error(t("messageRequired"));
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error(t("authFailed"));
      const pdf = await reportPdfBase64(model);
      const response: any = await request(
        { path: "/statements/report/send-email", method: "POST" },
        {
          to,
          cc: cc.length ? cc : undefined,
          bcc: bcc.length ? bcc : undefined,
          subject,
          message,
          filename: pdf.filename,
          pdfBase64: pdf.base64,
          reportTitle: title,
        },
        token,
      );
      if (response?.success === false) throw new Error(response?.message || t("sendFailed"));
      toast.success(t("sent", { doc: title }));
      onClose();
    } catch (e: any) {
      setError(e?.message || t("sendFailed"));
      toast.error(e?.message || t("sendFailed"));
    } finally {
      setLoading(false);
    }
  };

  const recipientInput = (
    label: string,
    value: string,
    setValue: (v: string) => void,
    onAdd: () => void,
    addLabel: string,
    list: string[],
    remove: (e: string) => void,
  ) => (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end" }}>
        <TextField
          label={label}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          fullWidth
          margin="normal"
          disabled={loading}
          placeholder={t("emailPlaceholder")}
          data-enter-ignore
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
        />
        <Button variant="outlined" onClick={onAdd} disabled={loading || !value} sx={{ mb: 1, minWidth: 100 }} startIcon={<AddIcon />}>
          {addLabel}
        </Button>
      </Box>
      {list.length > 0 && (
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 1 }}>
          {list.map((email) => (
            <Chip key={email} label={email} onDelete={() => remove(email)} disabled={loading} size="small" />
          ))}
        </Box>
      )}
    </Box>
  );

  return (
    <Dialog
      open={open}
      onClose={loading ? undefined : onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          m: { xs: 0, sm: 4 },
          width: "100%",
          maxWidth: { xs: "100%", sm: 960 },
          borderRadius: { xs: 0, sm: 1 },
          minHeight: { xs: "100%", sm: "auto" },
          maxHeight: { xs: "100%", sm: "calc(100% - 64px)" },
        },
      }}
    >
      <DialogTitle>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography component="span" variant="h6">{t("sendTitle", { doc: title })}</Typography>
          <IconButton onClick={onClose} disabled={loading}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <TextField label={t("from")} value="admin@osiris.sg" fullWidth disabled margin="normal" sx={{ mb: 2 }} />

        <Autocomplete
          multiple
          freeSolo
          options={[]}
          value={to}
          onChange={(_, newValue) => {
            const cleaned = (newValue as string[]).flatMap((v) => v.split(/[,\s]+/)).map((v) => v.trim()).filter(Boolean);
            const unique = Array.from(new Set(cleaned));
            const invalid = unique.filter((v) => !validateEmail(v));
            if (invalid.length) toast.error(t("invalidEmail", { emails: invalid.join(", ") }));
            setTo(unique.filter(validateEmail));
          }}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => <Chip {...getTagProps({ index })} key={option} label={option} size="small" />)
          }
          renderInput={(params) => (
            <TextField
              {...params}
              label={t("to")}
              required
              margin="normal"
              disabled={loading}
              error={to.length === 0}
              helperText={to.length === 0 ? t("toRequired") : t("toHelp")}
              inputProps={{ ...params.inputProps, "data-enter-ignore": true }}
            />
          )}
          disabled={loading}
          sx={{ mb: 2 }}
        />

        {recipientInput(t("cc"), newCcEmail, setNewCcEmail, () => addTo(cc, setCc, newCcEmail, () => setNewCcEmail(""), "alreadyCc"), t("addCc"), cc, (e) => setCc(cc.filter((x) => x !== e)))}
        {recipientInput(t("bcc"), newBccEmail, setNewBccEmail, () => addTo(bcc, setBcc, newBccEmail, () => setNewBccEmail(""), "alreadyBcc"), t("addBcc"), bcc, (e) => setBcc(bcc.filter((x) => x !== e)))}

        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary">
            {t("attachment")}
          </Typography>
          <Box sx={{ mt: 1 }}>
            <Chip icon={<AttachFileIcon />} label={filename} color="primary" variant="outlined" />
          </Box>
        </Box>

        <TextField
          label={t("subject")}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          fullWidth
          required
          margin="normal"
          disabled={loading}
          error={!subject.trim()}
          helperText={!subject.trim() ? t("subjectRequired") : ""}
          sx={{ mb: 2 }}
        />

        <TextField
          label={t("message")}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          fullWidth
          required
          multiline
          rows={8}
          margin="normal"
          disabled={loading}
          error={!message.trim()}
          helperText={!message.trim() ? t("messageRequired") : ""}
        />
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} disabled={loading}>
          {t("cancel")}
        </Button>
        <Button
          variant="contained"
          onClick={handleSend}
          disabled={loading || to.length === 0 || !subject.trim() || !message.trim()}
          startIcon={loading ? <CircularProgress size={20} /> : <SendIcon />}
        >
          {loading ? t("sending") : t("send")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
