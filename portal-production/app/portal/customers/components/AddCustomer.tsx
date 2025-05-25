import FormInputBox from "@/form-components/FormInputBox";
import { Drawer, Typography, Stack, Button, useTheme } from "@mui/material";
import { useForm } from "react-hook-form";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { useEffect } from "react";

interface AddCustomerProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  customerId?: string;
  isEditMode?: boolean;
}

export default function AddCustomer({ open, onClose, onSuccess, customerId, isEditMode = false }: AddCustomerProps) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const theme = useTheme();

  const { control, handleSubmit, reset, setValue } = useForm({
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      address: "",
    },
  });

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
    <Drawer anchor="right" open={open} onClose={onClose} sx={{ "& .MuiDrawer-paper": { width: "400px", backgroundColor: theme.palette.tertiary.contrastText } }}>
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
