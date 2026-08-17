import FormInputBox from "@/form-components/FormInputBox";
import FormSelect from "@/form-components/FormSelect";
import DateRangePicker from "@/form-components/FormDateRangePicker";
import { Stack, Typography, Box } from "@mui/material";
import React, { useState, useEffect } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import AddCustomer from "./AddCustomer";
import AddSiteOffice from "./AddSiteOffice";
import { useGetCustomers } from "../hooks/useGetCustomers";
import { useGetSiteOffices } from "../hooks/useGetSiteOffices";

export default function ProjectCreation() {
  const {
    control,
    setValue,
    formState: { errors },
  } = useFormContext();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [siteOfficeDrawerOpen, setSiteOfficeDrawerOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const { customers, refetch } = useGetCustomers();
  console.log("Customers:", customers);

  const { siteOffices, fetchSiteOffices } = useGetSiteOffices();
  const watchedCustomerId = useWatch({ control, name: "customerId" });

  useEffect(() => {
    if (watchedCustomerId) {
      fetchSiteOffices(watchedCustomerId);
    }
  }, [watchedCustomerId]);

  const handleOpenDrawer = () => setDrawerOpen(true);
  const handleCloseDrawer = (newCustomerId?: string) => {
    setDrawerOpen(false);
    if (newCustomerId) {
      setSelectedCustomerId(newCustomerId);
      setValue("customerId", newCustomerId); // ✅ force update the form field
    }
    refetch();
  };

  const watchedStartDate = useWatch({ control, name: "startDate" });
  const watchedEndDate = useWatch({ control, name: "endDate" });

  return (
    <>
      <Stack direction="column" spacing="var(--default-gap)">
        <FormInputBox control={control} name="name" label="Name" placeHolder="Enter Project Name" required />

        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography variant="body1">Customer *</Typography>
            <Typography variant="body2" color="primary" sx={{ cursor: "pointer", textDecoration: "underline" }} onClick={handleOpenDrawer}>
              Add New Customer
            </Typography>
          </Box>

          <FormSelect control={control} name="customerId" label="" menuTitle="Choose a customer" menuItems={customers.map((item) => ({ label: item.name, value: String(item.id) }))} defaultValue={selectedCustomerId} required />
          {watchedCustomerId && (
            <>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Typography variant="body1">Site Office *</Typography>
                <Typography variant="body2" color="primary" sx={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => setSiteOfficeDrawerOpen(true)}>
                  Add New Site Office
                </Typography>
              </Box>
              <FormSelect control={control} name="siteOfficeId" label="" menuTitle="Choose a site office" menuItems={siteOffices.map((item) => ({ label: item.name, value: item.id }))} required />
            </>
          )}
          <Box sx={{ mt: 2 }}>
            <DateRangePicker
              label="Project Duration *"
              value={{
                startDate: watchedStartDate,
                endDate: watchedEndDate,
              }}
              onConfirm={(range) => {
                setValue("startDate", range.startDate);
                setValue("endDate", range.endDate);
              }}
            />
            {(errors.startDate || errors.endDate) && (
              <Typography variant="caption" color="error">
                {(errors.startDate?.message as string) || (errors.endDate?.message as string)}
              </Typography>
            )}
          </Box>
        </Box>
      </Stack>

      <AddCustomer open={drawerOpen} onClose={() => handleCloseDrawer()} onSuccess={(id) => handleCloseDrawer(id)} />
      {watchedCustomerId && (
        <AddSiteOffice
          open={siteOfficeDrawerOpen}
          onClose={() => setSiteOfficeDrawerOpen(false)}
          customerId={watchedCustomerId}
          onSuccess={(siteOffice) => {
            setSiteOfficeDrawerOpen(false);
            fetchSiteOffices(watchedCustomerId);
            if (siteOffice?.id) {
              setValue("siteOfficeId", siteOffice.id);
            }
          }}
        />
      )}
    </>
  );
}
