"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Box, Typography, Alert, Button, Card, CardContent, CircularProgress } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MainCard from "@/components/MainCard";

export default function IntegrationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);

  // Get URL parameters
  const xeroStatus = searchParams.get("xero");
  const errorDetails = searchParams.get("details");
  const debugMessage = searchParams.get("msg");

  useEffect(() => {
    // Simulate a brief loading state
    const timer = setTimeout(() => {
      setLoading(false);
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  const handleBackToInvoices = () => {
    router.push("/portal/invoices");
  };

  const handleRetryConnection = () => {
    // This would trigger the OAuth flow again
    // For now, just redirect back to invoices where they can click Connect Xero again
    router.push("/portal/invoices");
  };

  if (loading) {
    return (
      <MainCard>
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "400px",
            gap: 2,
          }}
        >
          <CircularProgress />
          <Typography variant="body1">Processing integration...</Typography>
        </Box>
      </MainCard>
    );
  }

  return (
    <MainCard>
      <Box sx={{ maxWidth: 800, mx: "auto", p: 3 }}>
        {/* Header */}
        <Box sx={{ mb: 4 }}>
          <Typography variant="h4" gutterBottom>
            Integrations
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage your third-party integrations
          </Typography>
        </Box>

        {/* Xero Integration Status */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
              <img src="https://developer.xero.com/static/images/documentation/xero_logo_hires.jpg" alt="Xero" style={{ width: 40, height: 40, objectFit: "contain" }} />
              <Typography variant="h6">Xero Accounting</Typography>
            </Box>

            {/* Success State */}
            {xeroStatus === "success" && (
              <Alert severity="success" icon={<CheckCircleIcon />} sx={{ mb: 2 }}>
                <Typography variant="h6" gutterBottom>
                  🎉 Xero Integration Successful!
                </Typography>
                <Typography variant="body2">Your Xero account has been successfully connected. Invoices created in the system will now be automatically synced to Xero.</Typography>
              </Alert>
            )}

            {/* Error State */}
            {xeroStatus === "error" && (
              <Alert severity="error" icon={<ErrorIcon />} sx={{ mb: 2 }}>
                <Typography variant="h6" gutterBottom>
                  ❌ Xero Integration Failed
                </Typography>
                <Typography variant="body2" gutterBottom>
                  There was an error connecting to Xero. Please try again.
                </Typography>
                {errorDetails && (
                  <Typography variant="caption" sx={{ display: "block", mt: 1, fontFamily: "monospace" }}>
                    Error details: {decodeURIComponent(errorDetails)}
                  </Typography>
                )}
              </Alert>
            )}

            {/* Debug State */}
            {xeroStatus === "debug" && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                <Typography variant="h6" gutterBottom>
                  🔧 Debug Information
                </Typography>
                <Typography variant="body2" gutterBottom>
                  OAuth flow completed with debug information.
                </Typography>
                {debugMessage && (
                  <Typography variant="caption" sx={{ display: "block", mt: 1, fontFamily: "monospace" }}>
                    Debug: {decodeURIComponent(debugMessage)}
                  </Typography>
                )}
              </Alert>
            )}

            {/* Default State (no URL params) */}
            {!xeroStatus && (
              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2">Connect your Xero account to automatically sync invoices and accounting data.</Typography>
              </Alert>
            )}

            {/* Action Buttons */}
            <Box sx={{ display: "flex", gap: 2, mt: 3 }}>
              <Button variant="contained" startIcon={<ArrowBackIcon />} onClick={handleBackToInvoices} color="primary">
                Back to Invoices
              </Button>

              {xeroStatus === "error" && (
                <Button variant="outlined" onClick={handleRetryConnection} color="primary">
                  Try Again
                </Button>
              )}
            </Box>
          </CardContent>
        </Card>

        {/* Integration Features */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Xero Integration Features
            </Typography>
            <Box component="ul" sx={{ pl: 2 }}>
              <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                ✅ Automatic invoice sync to Xero
              </Typography>
              <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                ✅ Customer contact management
              </Typography>
              <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                ✅ Chart of accounts integration
              </Typography>
              <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                ✅ Real-time status monitoring
              </Typography>
              <Typography component="li" variant="body2">
                ✅ 60-day token refresh cycle
              </Typography>
            </Box>
          </CardContent>
        </Card>
      </Box>
    </MainCard>
  );
}
