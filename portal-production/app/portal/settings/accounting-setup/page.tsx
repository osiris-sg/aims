"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Divider,
  Paper,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import SettingsIcon from "@mui/icons-material/SettingsSuggest";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import BusinessIcon from "@mui/icons-material/Business";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";
import DefaultSettingsTab from "./components/DefaultSettingsTab";
import FinancialSettingsTab from "./components/FinancialSettingsTab";
import AccountsDefinitionTab from "./components/AccountsDefinitionTab";
import InventoryCostTab from "./components/InventoryCostTab";
import CostCentersTab from "./components/CostCentersTab";
import RevenueItemsTab from "./components/RevenueItemsTab";
import SellIcon from "@mui/icons-material/Sell";

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div role="tabpanel" hidden={value !== index}>
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

export default function AccountingSetupPage() {
  const { getToken } = useAuth();
  const [tabValue, setTabValue] = useState(0);
  const [settings, setSettings] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const apiBase = process.env.NEXT_PUBLIC_BACKEND_API_URL;

  const authedFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getToken();
      const headers: Record<string, string> = {
        ...(init?.headers as Record<string, string> | undefined),
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };
      if (typeof window !== "undefined") {
        const activeOrgId = window.sessionStorage.getItem("aims-admin-active-org");
        if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
      }
      return fetch(`${apiBase}${path}`, { ...init, headers });
    },
    [apiBase, getToken]
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, accountsRes] = await Promise.all([
        authedFetch("/accounting/settings"),
        authedFetch("/accounting/accounts"),
      ]);
      if (settingsRes.ok) {
        const json = await settingsRes.json();
        setSettings(json?.data ?? json);
      }
      if (accountsRes.ok) {
        const json = await accountsRes.json();
        const list = json?.data ?? json;
        setAccounts(Array.isArray(list) ? list : []);
      }
    } catch (e) {
      console.error("[AccountingSetup] load failed", e);
      toast.error("Failed to load accounting setup");
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const saveSettings = async (updates: any) => {
    const toastId = toast.loading("Saving settings...");
    try {
      const res = await authedFetch("/accounting/settings", {
        method: "PUT",
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setSettings(json?.data ?? json);
      toast.update(toastId, { render: "Settings saved", type: "success", isLoading: false, autoClose: 2000 });
    } catch (e: any) {
      toast.update(toastId, { render: e?.message || "Save failed", type: "error", isLoading: false, autoClose: 4000 });
    }
  };

  const seedDefaults = async () => {
    const toastId = toast.loading("Seeding default chart of accounts...");
    try {
      const res = await authedFetch("/accounting/accounts/seed-defaults", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      await loadAll();
      toast.update(toastId, { render: "Default accounts created", type: "success", isLoading: false, autoClose: 2500 });
    } catch (e: any) {
      toast.update(toastId, { render: e?.message || "Seed failed", type: "error", isLoading: false, autoClose: 4000 });
    }
  };

  const createAccount = async (payload: any) => {
    const res = await authedFetch("/accounting/accounts", { method: "POST", body: JSON.stringify(payload) });
    if (!res.ok) throw new Error((await res.json())?.message || "Create failed");
    await loadAll();
  };

  const updateAccount = async (id: string, payload: any) => {
    const res = await authedFetch(`/accounting/accounts/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
    if (!res.ok) throw new Error((await res.json())?.message || "Update failed");
    await loadAll();
  };

  const deleteAccount = async (id: string) => {
    const res = await authedFetch(`/accounting/accounts/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error((await res.json())?.message || "Delete failed");
    await loadAll();
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        Accounting Setup
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        Configure your base currency, document number sequences, opening balances, tax settings, and the chart of accounts used by the general ledger.
      </Typography>
      <Divider />

      <Paper sx={{ width: "100%" }}>
        <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
          <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)}>
            <Tab icon={<SettingsIcon />} iconPosition="start" label="Default Settings" />
            <Tab icon={<AccountBalanceIcon />} iconPosition="start" label="Financial Settings" />
            <Tab icon={<AccountTreeIcon />} iconPosition="start" label="Accounts Definition" />
            <Tab icon={<Inventory2Icon />} iconPosition="start" label="Inventory Cost" />
            <Tab icon={<BusinessIcon />} iconPosition="start" label="Cost Centers" />
            <Tab icon={<SellIcon />} iconPosition="start" label="Revenue Mapping" />
          </Tabs>
        </Box>

        <TabPanel value={tabValue} index={0}>
          <DefaultSettingsTab settings={settings} loading={loading} onSave={saveSettings} />
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          <FinancialSettingsTab settings={settings} loading={loading} onSave={saveSettings} />
        </TabPanel>

        <TabPanel value={tabValue} index={2}>
          <AccountsDefinitionTab
            settings={settings}
            accounts={accounts}
            loading={loading}
            onSaveSettings={saveSettings}
            onSeedDefaults={seedDefaults}
            onCreateAccount={createAccount}
            onUpdateAccount={updateAccount}
            onDeleteAccount={deleteAccount}
          />
        </TabPanel>

        <TabPanel value={tabValue} index={3}>
          <InventoryCostTab />
        </TabPanel>

        <TabPanel value={tabValue} index={4}>
          <CostCentersTab />
        </TabPanel>

        <TabPanel value={tabValue} index={5}>
          <RevenueItemsTab accounts={accounts} authedFetch={authedFetch} />
        </TabPanel>
      </Paper>
    </Box>
  );
}
