import FormInputBox from "@/form-components/FormInputBox";
import { Drawer, Typography, Stack, Button, useTheme } from "@mui/material";
import { useForm } from "react-hook-form";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { toast } from "react-toastify";

interface AddSiteOfficeProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (siteOffice: any) => void;
  customerId: string;
}

export default function AddSiteOffice({ open, onClose, onSuccess, customerId }: AddSiteOfficeProps) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const theme = useTheme();

  const { control, handleSubmit, reset } = useForm({
    defaultValues: {
      name: "",
      address: "",
      contactName: "",
      contactEmail: "",
      contactPhone: "",
    },
  });

  const onSubmit = async (data: any) => {
    try {
      const token = await getToken();
      if (!token || !organization?.id || !customerId) return;

      const contactDetails = [];
      if (data.contactName || data.contactEmail || data.contactPhone) {
        contactDetails.push({
          name: data.contactName || "",
          email: data.contactEmail || "",
          phone: data.contactPhone || "",
        });
      }

      const response = await request(
        {
          path: `/customers/${customerId}/site-offices`,
          method: "POST",
        },
        {
          name: data.name,
          address: data.address || undefined,
          contactDetails,
        },
        token
      );

      if (response.success) {
        toast.success("Site office added successfully");
        reset();
        onSuccess(response.data);
      }
    } catch (error) {
      console.error("Error creating site office:", error);
    }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} sx={{ "& .MuiDrawer-paper": { width: "400px", backgroundColor: theme.palette.tertiary.contrastText } }}>
      <Stack direction="column" gap="var(--double-gap)" padding="var(--default-padding)" height="100%" width="100%" display="flex" alignItems="center" justifyContent="center">
        <Typography variant="body1" sx={{ width: "100%" }}>
          Add Site Office
        </Typography>
        <form style={{ width: "100%" }} onSubmit={handleSubmit(onSubmit)}>
          <Stack direction="column" gap="var(--default-gap)" width="100%">
            <FormInputBox control={control} name="name" label="Site Office Name" placeHolder="Enter site office name" required />
            <FormInputBox control={control} name="address" label="Address" placeHolder="Enter address" />
            <Typography variant="body2" sx={{ color: "text.secondary", mt: 1 }}>
              Contact Details (Optional)
            </Typography>
            <FormInputBox control={control} name="contactName" label="Contact Name" placeHolder="Enter contact name" />
            <FormInputBox control={control} name="contactEmail" label="Contact Email" placeHolder="Enter contact email" type="email" />
            <FormInputBox control={control} name="contactPhone" label="Contact Phone" placeHolder="Enter contact phone" />
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
              Save
            </Button>
          </Stack>
        </form>
      </Stack>
    </Drawer>
  );
}
