import { KeyMintLoader } from "@/components/ui/keymint-loader";

export default function Loading() {
  return (
    <KeyMintLoader
      size="lg"
      variant="page"
      label="Verifying access to Keymint"
    />
  );
}
