import FormInputBox from "@/form-components/FormInputBox";
import { Drawer, Typography, Stack, Button, useTheme } from "@mui/material";
import useAddCustomerFormHandler from "../hooks/useAddCustomerFormHandler";

interface AddCustomerProps {
  open: boolean;
  onClose: () => void;
}

export default function AddCustomer({ open, onClose }: AddCustomerProps) {
  const { control, handleSubmit, onSubmit } = useAddCustomerFormHandler();
  const theme = useTheme();

  return (
    <Drawer anchor="right" open={open} onClose={onClose} sx={{ "& .MuiDrawer-paper": { width: "400px", backgroundColor: "background.paper", backgroundImage: "none", borderLeft: 1, borderColor: "divider" } }}>
      <Stack direction="column" gap="var(--double-gap)" padding="var(--default-padding)" height="100%" width="100%" display="flex" alignItems="center" justifyContent="center">
        <Typography variant="body1" sx={{ width: "100%" }}>
          Add Customer
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
              Save
            </Button>
          </Stack>
        </form>
      </Stack>
    </Drawer>
  );
}
