"use client";

import React, { useState } from "react";
import { Drawer, Box, Typography, Button, List, ListItem, ListItemButton, ListItemText, ListItemAvatar, Avatar, TextField, InputAdornment, CircularProgress, Alert, Divider } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import PersonIcon from "@mui/icons-material/Person";
import CloseIcon from "@mui/icons-material/Close";
import { useGetCustomers } from "@/app/portal/hooks/api";

interface Customer {
  id: string;
  name: string;
  email?: string;
  address?: string;
}

interface CustomerSelectionDrawerProps {
  open: boolean;
  onClose: () => void;
  onSelectCustomer: (customer: Customer) => void;
}

export default function CustomerSelectionDrawer({ open, onClose, onSelectCustomer }: CustomerSelectionDrawerProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const { customers = [], isLoading, error } = useGetCustomers({ limit: 1000 });

  // Filter customers based on search term
  const filteredCustomers = customers.filter((customer: Customer) => customer.name.toLowerCase().includes(searchTerm.toLowerCase()) || (customer.email && customer.email.toLowerCase().includes(searchTerm.toLowerCase())));

  const handleSelectCustomer = (customer: Customer) => {
    onSelectCustomer(customer);
    onClose();
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
            Select Customer
          </Typography>
          <Button onClick={handleClose} sx={{ minWidth: "auto", p: 1 }} color="inherit">
            <CloseIcon />
          </Button>
        </Box>

        {/* Search */}
        <Box sx={{ p: 2 }}>
          <TextField
            fullWidth
            placeholder="Search customers..."
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
          ) : error ? (
            <Box sx={{ p: 2 }}>
              <Alert severity="error">{error}</Alert>
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
              <Typography variant="body1">{searchTerm ? "No customers found" : "No customers available"}</Typography>
              {searchTerm && (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  Try adjusting your search terms
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
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
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
            Select a customer to create an invoice
          </Typography>
        </Box>
      </Box>
    </Drawer>
  );
}
