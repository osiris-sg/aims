/* eslint-disable @typescript-eslint/no-explicit-any */
import FormInputBox from "@/form-components/FormInputBox";
import FormSelect from "@/form-components/FormSelect";
import { Drawer, Typography, Stack, Button, useTheme } from "@mui/material";
import useAddInventoryFormHandler from "../hooks/useAddInventoryFormHandler";
import { INVENTORY_STATUS } from "../slice/constants";
import { useGetCountries } from "../hooks/useGetCountries";
interface AddInventoryItemProps {
  open: boolean;
  onClose: () => void;
}

export default function AddInventoryItem({ open, onClose }: AddInventoryItemProps) {
  const { control, handleSubmit, onSubmit, assets, isSkuLoading, isInvetoryUpdating } = useAddInventoryFormHandler();
  const { countries } = useGetCountries();
  const theme = useTheme();

  return (
    <Drawer anchor="right" open={open} onClose={onClose} sx={{ "& .MuiDrawer-paper": { width: "400px", backgroundColor: theme.palette.tertiary.contrastText } }}>
      <Stack direction="column" gap="var(--double-gap)" padding="var(--default-padding)" height="100%" width="100%" display="flex" alignItems="center" justifyContent="center">
        <Typography variant="body1" sx={{ width: "100%" }}>
          Add Items
        </Typography>
        <form style={{ width: "100%" }} onSubmit={handleSubmit(onSubmit)}>
          <Stack direction="column" gap="var(--default-gap)" width="100%">
            <FormSelect control={control} name="assetId" label="Asset" addItem={false} menuTitle="Choose an asset" menuItems={assets.docs.map((asset) => ({ label: asset.name, value: asset.id }))} />
            <FormInputBox loading={isSkuLoading} control={control} name="sku" label="SKU" placeHolder="Enter SKU" disabled={true} />
            <FormInputBox control={control} name="quantity" label="Quantity" placeHolder="Enter quantity" type="number" min={1} integerOnly={true} />
            <FormInputBox control={control} name="category" label="Category" placeHolder="Enter a category" disabled={true} />
            <FormSelect control={control} name="location" label="Location" addItem={false} menuTitle="Choose a location" menuItems={countries} />
            <FormSelect control={control} name="status" label="Status" addItem={false} menuTitle="Choose status" menuItems={INVENTORY_STATUS} />
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
            <Button variant="outlined" type="button" onClick={onClose} disabled={isSkuLoading}>
              Cancel
            </Button>

            <Button variant="contained" type="submit" disabled={isSkuLoading} loading={isInvetoryUpdating}>
              Save
            </Button>
          </Stack>
        </form>
      </Stack>
    </Drawer>
  );
}
