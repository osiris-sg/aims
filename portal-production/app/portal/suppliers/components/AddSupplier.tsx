import FormInputBox from "@/form-components/FormInputBox";
import { Drawer, Typography, Stack, Button, useTheme } from "@mui/material";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { yupResolver } from "@hookform/resolvers/yup";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { useEffect } from "react";

interface AddSupplierProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  supplierId?: string;
  isEditMode?: boolean;
}

const supplierSchema = yup.object().shape({
  name: yup.string().required("Supplier name is required"),
  email: yup.string().email("Invalid email").notRequired(),
  phone: yup.string().notRequired(),
  address: yup.string().notRequired(),
  gstRegNo: yup.string().notRequired(),
});

export default function AddSupplier({ open, onClose, onSuccess, supplierId, isEditMode = false }: AddSupplierProps) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const theme = useTheme();

  const { control, handleSubmit, reset, setValue } = useForm({
    defaultValues: {
      name: "",
      email: null,
      phone: null,
      address: null,
      gstRegNo: null,
    },
    resolver: yupResolver(supplierSchema),
  });

  useEffect(() => {
    const fetchSupplier = async () => {
      if (isEditMode && supplierId) {
        try {
          const token = await getToken();
          if (!token || !organization?.id) return;

          const response = await request(
            {
              path: `/suppliers/${supplierId}`,
              method: "GET",
            },
            {},
            token
          );

          if (response.success) {
            const supplier = response.data;
            setValue("name", supplier.name);
            setValue("email", supplier.email);
            setValue("phone", supplier.phone);
            setValue("address", supplier.address);
            setValue("gstRegNo", supplier.gstRegNo);
          }
        } catch (error) {
          console.error("Error fetching supplier:", error);
        }
      }
    };

    fetchSupplier();
  }, [isEditMode, supplierId, getToken, organization?.id, setValue]);

  const onSubmit = async (data: any) => {
    try {
      const token = await getToken();
      if (!token || !organization?.id) return;

      const response = await request(
        {
          path: isEditMode ? "/suppliers/update" : "/suppliers/create",
          method: isEditMode ? "PUT" : "POST",
        },
        {
          ...data,
          ...(isEditMode && { id: supplierId }),
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
          {isEditMode ? "Edit Supplier" : "Add Supplier"}
        </Typography>
        <form style={{ width: "100%" }} onSubmit={handleSubmit(onSubmit)}>
          <Stack direction="column" gap="var(--default-gap)" width="100%">
            <FormInputBox control={control} name="name" label="Name" placeHolder="Enter supplier name" />
            <FormInputBox control={control} name="email" label="Email" placeHolder="Enter supplier email" type="email" />
            <FormInputBox control={control} name="phone" label="Phone" placeHolder="Enter supplier phone number" />
            <FormInputBox control={control} name="address" label="Address" placeHolder="Enter supplier address" />
            <FormInputBox control={control} name="gstRegNo" label="GST Reg No." placeHolder="Enter GST registration number" />
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
