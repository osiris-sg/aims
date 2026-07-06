"use client";

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  Chip,
  IconButton,
  Typography,
  Alert,
  CircularProgress,
  Autocomplete,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import SendIcon from "@mui/icons-material/Send";
import AddIcon from "@mui/icons-material/Add";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { toast } from "react-toastify";
import moment from "moment";

interface SendInvoiceEmailDialogProps {
  open: boolean;
  onClose: () => void;
  onSent: () => void;
  invoice: {
    id: string;
    name: string;
    config: any;
    type: string;
    status: string;
    organizationId: string;
  };
  customer: {
    id: string;
    name: string;
    email?: string;
  };
  /** Sender org's display name for subject/body signature. Falls back to a
   *  generic sign-off when absent (never the old hardcoded OSIRIS name). */
  organizationName?: string;
}

// Same type lists the backend's send-email guard uses (documents.service.ts
// sendInvoiceEmail) — keep in sync.
const QUOTATION_TYPES = ["QUOTATION", "QO", "QO1", "QO2", "QT"];
const INVOICE_TYPES = ["INVOICE", "TI", "TI2"];

export default function SendInvoiceEmailDialog({
  open,
  onClose,
  onSent,
  invoice,
  customer,
  organizationName,
}: SendInvoiceEmailDialogProps) {
  // Type-aware wording: quotations get quote language (no due date / payment
  // wording); unknown types degrade to a neutral "Document".
  const docTypeUpper = (invoice?.type || "").toUpperCase();
  const isQuotation = QUOTATION_TYPES.includes(docTypeUpper);
  const isInvoice = INVOICE_TYPES.includes(docTypeUpper);
  const docLabel = isQuotation ? "Quotation" : isInvoice ? "Invoice" : "Document";
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Email fields
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  // Input fields for adding emails
  const [newCcEmail, setNewCcEmail] = useState("");
  const [newBccEmail, setNewBccEmail] = useState("");

  // Initialize email fields when dialog opens
  useEffect(() => {
    if (open && invoice && customer) {
      // TO prefill rule: ONLY from a COMPLETE attention record — name, email,
      // AND phone all present. Partial records (common: email-only) leave TO
      // empty for the user to fill deliberately. No customer.email fallback.
      // Sending is read-only w.r.t. contact data — nothing is created here.
      const att = invoice.config?.attention || {};
      const attName: string = (att.name || "").trim();
      const attEmail: string = (att.email || "").trim();
      const attPhone: string = (att.phoneNumber || att.phone || "").trim();
      const attentionComplete = Boolean(attName && attEmail && attPhone);
      setTo(attentionComplete ? [attEmail] : []);

      const docNumber =
        invoice.name || `${isQuotation ? "QO" : "INV"}-${invoice.id.substring(0, 8)}`;
      const orgName = organizationName || invoice.config?.company?.name || "";
      setSubject(`${docLabel} ${docNumber}${orgName ? ` from ${orgName}` : ""}`);

      const items = invoice.config?.items || [];
      const totalAmount = items.reduce((sum: number, item: any) => {
        const amount =
          parseFloat(item.amount) ||
          parseFloat(item.quantity) * parseFloat(item.unitPrice) ||
          0;
        return sum + amount;
      }, 0);

      // Greeting: the attention name only when the record was complete enough
      // to prefill TO; otherwise a generic salutation.
      const greetName = attentionComplete ? attName : "there";

      let messageTemplate: string;
      if (isInvoice) {
        // Invoice body unchanged: due date + payment-details language.
        const dueDate = invoice.config?.dueDate
          ? moment(invoice.config.dueDate).format("DD MMM YYYY")
          : moment().add(30, "days").format("DD MMM YYYY");
        messageTemplate = `Hi ${greetName},

Please find attached the invoice ${docNumber} amounting to SGD ${totalAmount.toFixed(2)} due on ${dueDate}.

You can also use the link below to see your invoice and its payment details.

If you have any questions, please don't hesitate to contact us.

Best regards,
${orgName}`;
      } else {
        // Quotations (and any other type, neutrally): no due date, no payment
        // wording.
        messageTemplate = `Hi ${greetName},

Please find attached the ${docLabel.toLowerCase()} ${docNumber} amounting to SGD ${totalAmount.toFixed(2)}.

If you have any questions, please don't hesitate to contact us.

Best regards,
${orgName}`;
      }

      setMessage(messageTemplate);
    }
  }, [open, invoice, customer, organizationName, docLabel, isQuotation, isInvoice]);

  const validateEmail = (email: string): boolean => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  };

  const handleAddCc = () => {
    if (newCcEmail && validateEmail(newCcEmail)) {
      if (!cc.includes(newCcEmail)) {
        setCc([...cc, newCcEmail]);
        setNewCcEmail("");
      } else {
        toast.warning("Email already in CC list");
      }
    } else {
      toast.error("Please enter a valid email");
    }
  };

  const handleAddBcc = () => {
    if (newBccEmail && validateEmail(newBccEmail)) {
      if (!bcc.includes(newBccEmail)) {
        setBcc([...bcc, newBccEmail]);
        setNewBccEmail("");
      } else {
        toast.warning("Email already in BCC list");
      }
    } else {
      toast.error("Please enter a valid email");
    }
  };

  const handleRemoveCc = (email: string) => {
    setCc(cc.filter((e) => e !== email));
  };

  const handleRemoveBcc = (email: string) => {
    setBcc(bcc.filter((e) => e !== email));
  };

  const handleSendEmail = async () => {
    // Validate required fields
    if (to.length === 0 || !to[0]) {
      toast.error("Recipient email is required");
      return;
    }

    if (!subject.trim()) {
      toast.error("Subject is required");
      return;
    }

    if (!message.trim()) {
      toast.error("Message is required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        throw new Error("Authentication failed");
      }

      const response = await request(
        {
          path: `/documents/${invoice.id}/send-email`,
          method: "POST",
        },
        {
          to,
          cc: cc.length > 0 ? cc : undefined,
          bcc: bcc.length > 0 ? bcc : undefined,
          subject,
          message,
        },
        token
      );

      if (response.success) {
        toast.success(`${docLabel} email sent successfully!`);
        onSent(); // Refresh the page/data
        onClose();
      } else {
        throw new Error(response.message || "Failed to send email");
      }
    } catch (error: any) {
      console.error("Error sending email:", error);
      setError(error.message || "Failed to send email");
      toast.error(error.message || "Failed to send email");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="h6">Send {docLabel} Email</Typography>
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

        {/* FROM field (read-only) */}
        <TextField
          label="FROM"
          value="admin@osiris.sg"
          fullWidth
          disabled
          margin="normal"
          sx={{ mb: 2 }}
        />

        {/* TO field */}
        <Autocomplete
          multiple
          freeSolo
          options={[]}
          value={to}
          onChange={(_, newValue) => {
            const cleaned = (newValue as string[])
              .flatMap((v) => v.split(/[,\s]+/))
              .map((v) => v.trim())
              .filter((v) => v.length > 0);
            const unique = Array.from(new Set(cleaned));
            const invalid = unique.filter((v) => !validateEmail(v));
            if (invalid.length > 0) {
              toast.error(`Invalid email: ${invalid.join(", ")}`);
            }
            setTo(unique.filter((v) => validateEmail(v)));
          }}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => (
              <Chip
                {...getTagProps({ index })}
                key={option}
                label={option}
                size="small"
              />
            ))
          }
          renderInput={(params) => (
            <TextField
              {...params}
              label="TO"
              required
              margin="normal"
              disabled={loading}
              error={to.length === 0}
              helperText={
                to.length === 0
                  ? "Recipient email is required"
                  : "Press Enter or comma to add an email"
              }
            />
          )}
          disabled={loading}
          sx={{ mb: 2 }}
        />

        {/* CC field */}
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end" }}>
            <TextField
              label="CC"
              value={newCcEmail}
              onChange={(e) => setNewCcEmail(e.target.value)}
              fullWidth
              margin="normal"
              disabled={loading}
              placeholder="Enter email address"
              onKeyPress={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddCc();
                }
              }}
            />
            <Button
              variant="outlined"
              onClick={handleAddCc}
              disabled={loading || !newCcEmail}
              sx={{ mb: 1, minWidth: 100 }}
              startIcon={<AddIcon />}
            >
              Add CC
            </Button>
          </Box>
          {cc.length > 0 && (
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 1 }}>
              {cc.map((email) => (
                <Chip
                  key={email}
                  label={email}
                  onDelete={() => handleRemoveCc(email)}
                  disabled={loading}
                  size="small"
                />
              ))}
            </Box>
          )}
        </Box>

        {/* BCC field */}
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end" }}>
            <TextField
              label="BCC"
              value={newBccEmail}
              onChange={(e) => setNewBccEmail(e.target.value)}
              fullWidth
              margin="normal"
              disabled={loading}
              placeholder="Enter email address"
              onKeyPress={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddBcc();
                }
              }}
            />
            <Button
              variant="outlined"
              onClick={handleAddBcc}
              disabled={loading || !newBccEmail}
              sx={{ mb: 1, minWidth: 100 }}
              startIcon={<AddIcon />}
            >
              Add BCC
            </Button>
          </Box>
          {bcc.length > 0 && (
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 1 }}>
              {bcc.map((email) => (
                <Chip
                  key={email}
                  label={email}
                  onDelete={() => handleRemoveBcc(email)}
                  disabled={loading}
                  size="small"
                />
              ))}
            </Box>
          )}
        </Box>

        {/* Attachment chip */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary">
            Attachment
          </Typography>
          <Box sx={{ mt: 1 }}>
            <Chip
              icon={<AttachFileIcon />}
              label={`${invoice?.name || docLabel}.pdf`}
              color="primary"
              variant="outlined"
            />
          </Box>
        </Box>

        {/* Subject field */}
        <TextField
          label="SUBJECT"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          fullWidth
          required
          margin="normal"
          disabled={loading}
          error={!subject.trim()}
          helperText={!subject.trim() ? "Subject is required" : ""}
          sx={{ mb: 2 }}
        />

        {/* Message field */}
        <TextField
          label="MESSAGE FOR CUSTOMER"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          fullWidth
          required
          multiline
          rows={8}
          margin="normal"
          disabled={loading}
          error={!message.trim()}
          helperText={!message.trim() ? "Message is required" : ""}
        />
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSendEmail}
          disabled={loading || to.length === 0 || !subject.trim() || !message.trim()}
          startIcon={loading ? <CircularProgress size={20} /> : <SendIcon />}
        >
          {loading ? "Sending..." : "Send Email"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}