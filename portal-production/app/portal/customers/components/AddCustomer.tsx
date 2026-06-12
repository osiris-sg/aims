import FormInputBox from "@/form-components/FormInputBox";
import { Drawer, Typography, Stack, Button, useTheme, FormControl, InputLabel, Select, MenuItem, FormHelperText, Box, IconButton, Divider } from "@mui/material";
import { Add as AddIcon, DeleteOutline as DeleteIcon } from "@mui/icons-material";
import { useForm, Controller, useFieldArray } from "react-hook-form";
import * as yup from "yup";
import { yupResolver } from "@hookform/resolvers/yup";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { useEffect, useState } from "react";

interface Salesman {
  id: string;
  salesmanCode: string;
  userId: string;
  name: string;
}

interface AddCustomerProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  customerId?: string;
  isEditMode?: boolean;
}

const customerSchema = yup.object().shape({
  name: yup.string().required("Customer name is required"),
  email: yup.string().email("Invalid email").notRequired(),
  phone: yup.string().notRequired(),
  address: yup.string().notRequired(),
  gstRegNo: yup.string().notRequired(),
  salesmanId: yup.string().nullable().notRequired(),
  contacts: yup
    .array()
    .of(
      yup.object({
        name: yup.string().notRequired(),
        phone: yup.string().notRequired(),
        email: yup.string().notRequired(),
        designation: yup.string().notRequired(),
      })
    )
    .notRequired(),
});

export default function AddCustomer({ open, onClose, onSuccess, customerId, isEditMode = false }: AddCustomerProps) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const theme = useTheme();
  const [salesmen, setSalesmen] = useState<Salesman[]>([]);
  const [loadingSalesmen, setLoadingSalesmen] = useState(false);

  const { control, handleSubmit, reset, setValue } = useForm({
    defaultValues: {
      name: "",
      email: null,
      phone: null,
      address: null,
      gstRegNo: null,
      salesmanId: null as string | null,
      contacts: [] as { name: string; phone: string; email: string; designation: string }[],
    },
    resolver: yupResolver(customerSchema),
  });

  const { fields: contactFields, append: appendContact, remove: removeContact } = useFieldArray({
    control,
    name: "contacts",
  });

  // Fetch salesmen when drawer opens
  useEffect(() => {
    const fetchSalesmen = async () => {
      if (!open) return;
      setLoadingSalesmen(true);
      try {
        const token = await getToken();
        if (!token || !organization?.id) return;

        const response = await request(
          {
            path: "/customers/salesmen",
            method: "GET",
          },
          {},
          token
        );

        if (response.success && response.data) {
          setSalesmen(response.data);
        } else if (Array.isArray(response)) {
          setSalesmen(response);
        }
      } catch (error) {
        console.error("Error fetching salesmen:", error);
      } finally {
        setLoadingSalesmen(false);
      }
    };

    fetchSalesmen();
  }, [open, getToken, organization?.id]);

  useEffect(() => {
    const fetchCustomer = async () => {
      if (isEditMode && customerId) {
        try {
          const token = await getToken();
          if (!token || !organization?.id) return;

          const response = await request(
            {
              path: `/customers/${customerId}`,
              method: "GET",
            },
            {},
            token
          );

          if (response.success) {
            const customer = response.data;
            setValue("name", customer.name);
            setValue("email", customer.email);
            setValue("phone", customer.phone);
            setValue("address", customer.address);
            setValue("gstRegNo", customer.gstRegNo);
            setValue("salesmanId", customer.salesmanId || null);
            setValue(
              "contacts",
              (customer.contacts || []).map((c: { name?: string; phone?: string; email?: string; designation?: string }) => ({
                name: c.name || "",
                phone: c.phone || "",
                email: c.email || "",
                designation: c.designation || "",
              }))
            );
          }
        } catch (error) {
          console.error("Error fetching customer:", error);
        }
      }
    };

    fetchCustomer();
  }, [isEditMode, customerId, getToken, organization?.id, setValue]);

  const onSubmit = async (data: any) => {
    try {
      const token = await getToken();
      if (!token || !organization?.id) return;

      const response = await request(
        {
          path: isEditMode ? "/customers/update" : "/customers/create",
          method: isEditMode ? "PUT" : "POST",
        },
        {
          ...data,
          contacts: (data.contacts || []).filter(
            (c: { name?: string }) => c.name && c.name.trim() !== ""
          ),
          ...(isEditMode && { id: customerId }),
          organizationId: organization.id,
        },
        token
      );

      if (response.success) {
        reset();
        onClose();
        onSuccess();
      }
    } catch (error) {
      console.error("Error submitting form:", error);
    }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} sx={{ "& .MuiDrawer-paper": { width: "400px", backgroundColor: "background.paper", backgroundImage: "none", borderLeft: 1, borderColor: "divider" } }}>
      <Stack direction="column" gap="var(--double-gap)" padding="var(--default-padding)" height="100%" width="100%" display="flex" alignItems="center" justifyContent="center">
        <Typography variant="body1" sx={{ width: "100%" }}>
          {isEditMode ? "Edit Customer" : "Add Customer"}
        </Typography>
        <form style={{ width: "100%" }} onSubmit={handleSubmit(onSubmit)}>
          <Stack direction="column" gap="var(--default-gap)" width="100%">
            <FormInputBox control={control} name="name" label="Name" placeHolder="Enter customer name" />
            <FormInputBox control={control} name="email" label="Email" placeHolder="Enter customer email" type="email" />
            <FormInputBox control={control} name="phone" label="Phone" placeHolder="Enter customer phone number" />
            <FormInputBox control={control} name="address" label="Address" placeHolder="Enter customer address" />
            <FormInputBox control={control} name="gstRegNo" label="GST Reg No." placeHolder="Enter GST registration number" />
            <Controller
              name="salesmanId"
              control={control}
              render={({ field, fieldState: { error } }) => (
                <FormControl fullWidth size="small" error={!!error}>
                  <InputLabel id="salesman-label">Salesman</InputLabel>
                  <Select
                    labelId="salesman-label"
                    label="Salesman"
                    value={field.value || ""}
                    onChange={(e) => field.onChange(e.target.value || null)}
                    disabled={loadingSalesmen}
                  >
                    <MenuItem value="">
                      <em>None</em>
                    </MenuItem>
                    {salesmen.map((salesman) => (
                      <MenuItem key={salesman.id} value={salesman.id}>
                        {salesman.name} ({salesman.salesmanCode})
                      </MenuItem>
                    ))}
                  </Select>
                  {error && <FormHelperText>{error.message}</FormHelperText>}
                </FormControl>
              )}
            />

            {/* Points of Contact (POC / "Attn To") */}
            <Divider sx={{ mt: 1 }} />
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="body2" fontWeight={600}>
                Points of Contact
              </Typography>
              <Button
                size="small"
                startIcon={<AddIcon fontSize="small" />}
                onClick={() => appendContact({ name: "", phone: "", email: "", designation: "" })}
              >
                Add
              </Button>
            </Stack>
            {contactFields.length === 0 && (
              <Typography variant="caption" color="text.secondary">
                No contacts yet. Add people to address documents to (Attn To).
              </Typography>
            )}
            {contactFields.map((field, index) => (
              <Box
                key={field.id}
                sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1, position: "relative" }}
              >
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    Contact {index + 1}
                  </Typography>
                  <IconButton size="small" onClick={() => removeContact(index)} aria-label="Remove contact">
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
                <Stack direction="column" gap="var(--default-gap)">
                  <FormInputBox control={control} name={`contacts.${index}.name`} label="Name" placeHolder="Contact name" />
                  <FormInputBox control={control} name={`contacts.${index}.phone`} label="Phone" placeHolder="Contact phone" />
                  <FormInputBox control={control} name={`contacts.${index}.email`} label="Email" placeHolder="Contact email" />
                  <FormInputBox control={control} name={`contacts.${index}.designation`} label="Designation" placeHolder="e.g. Procurement Manager" />
                </Stack>
              </Box>
            ))}
          </Stack>
          <Stack
            direction="row"
            width="100%"
            sx={{
              justifyContent: "space-between",
              py: "var(--quarter-gap)",
              mt: "var(--double-gap)",
            }}
          >
            <Button variant="outlined" type="button" onClick={onClose}>
              Cancel
            </Button>

            <Button variant="contained" type="submit">
              {isEditMode ? "Save Changes" : "Save"}
            </Button>
          </Stack>
        </form>
      </Stack>
    </Drawer>
  );
}
