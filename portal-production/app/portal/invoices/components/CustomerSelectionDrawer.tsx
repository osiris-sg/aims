"use client";

import React, { useEffect, useState } from "react";
import { Drawer, Box, Typography, Button, List, ListItem, ListItemButton, ListItemText, ListItemAvatar, Avatar, TextField, InputAdornment, CircularProgress, Divider } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import PersonIcon from "@mui/icons-material/Person";
import CloseIcon from "@mui/icons-material/Close";
import { useCustomerSearch } from "@/app/portal/hooks/api/useCustomerPicker";
import { useTranslations } from "next-intl";
import { customerIdsLine, rankCustomers } from "@/helpers/customerIds";

interface Customer {
  id: string;
  name: string;
  email?: string;
  address?: string;
  uen?: string | null;
  externalRef?: string | null;
}

interface CustomerSelectionDrawerProps {
  open: boolean;
  onClose: () => void;
  onSelectCustomer: (customer: Customer) => void;
}

export default function CustomerSelectionDrawer({ open, onClose, onSelectCustomer }: CustomerSelectionDrawerProps) {
  const t = useTranslations("invoices.customerDrawer");
  const [searchTerm, setSearchTerm] = useState("");
  // Server search as you type (code, name, email, phone, address, UEN, old
  // code): orgs have thousands of customers, a pre-loaded list missed most.
  const [term, setTerm] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setTerm(searchTerm), 250);
    return () => clearTimeout(id);
  }, [searchTerm]);
  const { customers, isLoading } = useCustomerSearch(term, { limit: 50, enabled: open });
  const filteredCustomers = rankCustomers(customers as Customer[], term);

  const handleSelectCustomer = (customer: Customer) => {
    onSelectCustomer(customer);
    // Don't call onClose here as it's handled by parent component
    // onClose();
    setSearchTerm(""); // Reset search
  };

  const handleClose = () => {
    onClose();
    setSearchTerm(""); // Reset search when closing
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={handleClose}
      PaperProps={{
        sx: {
          width: { xs: "100%", sm: 400 },
          maxWidth: "100vw",
        },
      }}
    >
      <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <Box
          sx={{
            p: 3,
            borderBottom: "1px solid",
            borderColor: "divider",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Typography variant="h6" component="h2">
            {t("title")}
          </Typography>
          <Button onClick={handleClose} sx={{ minWidth: "auto", p: 1 }} color="inherit">
            <CloseIcon />
          </Button>
        </Box>

        {/* Search */}
        <Box sx={{ p: 2 }}>
          <TextField
            fullWidth
            placeholder={t("search")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
            }}
            size="small"
          />
        </Box>

        {/* Content */}
        <Box sx={{ flex: 1, overflow: "hidden" }}>
          {isLoading ? (
            <Box
              sx={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: "200px",
              }}
            >
              <CircularProgress />
            </Box>
          ) : filteredCustomers.length === 0 ? (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "200px",
                color: "text.secondary",
              }}
            >
              <PersonIcon sx={{ fontSize: "3rem", mb: 2, opacity: 0.5 }} />
              <Typography variant="body1">{searchTerm ? t("noneFound") : t("noneAvailable")}</Typography>
              {searchTerm && (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {t("adjustSearch")}
                </Typography>
              )}
            </Box>
          ) : (
            <List sx={{ overflow: "auto", height: "100%" }}>
              {filteredCustomers.map((customer: Customer, index: number) => (
                <React.Fragment key={customer.id}>
                  <ListItem disablePadding>
                    <ListItemButton
                      onClick={() => handleSelectCustomer(customer)}
                      sx={{
                        py: 2,
                        "&:hover": {
                          backgroundColor: "action.hover",
                        },
                      }}
                    >
                      <ListItemAvatar>
                        <Avatar sx={{ bgcolor: "primary.main" }}>
                          <PersonIcon />
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={
                          <Typography variant="subtitle1" fontWeight="medium">
                            {customer.name}
                          </Typography>
                        }
                        secondary={
                          <Box>
                            {customerIdsLine(customer) && (
                              <Typography variant="body2" color="text.secondary">
                                {customerIdsLine(customer)}
                              </Typography>
                            )}
                            {customer.email && (
                              <Typography variant="body2" color="text.secondary">
                                {customer.email}
                              </Typography>
                            )}
                            {customer.address && (
                              <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{
                                  whiteSpace: "normal",
                                  wordBreak: "break-word",
                                  maxWidth: "250px",
                                }}
                              >
                                {customer.address}
                              </Typography>
                            )}
                          </Box>
                        }
                      />
                    </ListItemButton>
                  </ListItem>
                  {index < filteredCustomers.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </List>
          )}
        </Box>

        {/* Footer */}
        <Box
          sx={{
            p: 2,
            borderTop: "1px solid",
            borderColor: "divider",
            backgroundColor: "background.paper",
          }}
        >
          <Typography variant="body2" color="text.secondary" textAlign="center">
            {t("footer")}
          </Typography>
        </Box>
      </Box>
    </Drawer>
  );
}
