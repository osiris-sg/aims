import FormInputBox from "@/form-components/FormInputBox";
import FormTextArea from "@/form-components/FormTextArea";
import { Drawer, Typography, Stack, Button, useTheme } from "@mui/material";
import { useForm } from "react-hook-form";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";

interface AddDocumentProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddDocument({ open, onClose, onSuccess }: AddDocumentProps) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const theme = useTheme();

  const { control, handleSubmit, reset } = useForm({
    defaultValues: {
      name: "",
      status: "",
      category: "",
      content: "",
    },
  });

  const onSubmit = async (data: any) => {
    try {
      const token = await getToken();
      if (!token || !organization?.id) return;

      const response = await request(
        {
          path: "/documents/create",
          method: "POST",
        },
        {
          ...data,
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
          Create Document
        </Typography>
        <form style={{ width: "100%" }} onSubmit={handleSubmit(onSubmit)}>
          <Stack direction="column" gap="var(--default-gap)" width="100%">
            <FormInputBox control={control} name="name" label="Name" placeHolder="Enter document name" />
            <FormInputBox control={control} name="status" label="Status" placeHolder="Enter document status" />
            <FormInputBox control={control} name="category" label="Category" placeHolder="Enter document category" />
            <FormTextArea control={control} name="content" label="Content" placeHolder="Enter document content" rows={4} />
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
