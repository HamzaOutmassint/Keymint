"use client";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button, FormField, Modal } from "@/components/ui";
import { categorySchema } from "./schemas";
import { useVaultData, useVaultMutations } from "@/features/vault/data";

type Form = z.input<typeof categorySchema>;
const colors = [
  "#3B82F6",
  "#22A06B",
  "#D97706",
  "#D14454",
  "#7C5CDB",
  "#087F8C",
];

export function CategoryModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const vault = useVaultData();
  const mutations = useVaultMutations();
  const form = useForm<Form>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: "", color: colors[0], icon: "folder" },
  });
  const selectedColor = useWatch({ control: form.control, name: "color" });
  async function submit(values: Form) {
    try {
      if (vault.data?.categories.some((item) => item.name.toLocaleLowerCase() === values.name.toLocaleLowerCase())) {
        throw new Error("A folder with this name already exists");
      }
      await mutations.saveCategory({ ...values, icon: values.icon ?? "folder", pinned: false });
      toast.success("Folder created");
      form.reset();
      onClose();
    } catch (error) {
      toast.error((error as Error).message);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a folder"
      description="Folders help you find related credentials without changing their protection."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={form.handleSubmit(submit)}
            disabled={form.formState.isSubmitting}
            loading={form.formState.isSubmitting}
            loadingLabel="Creating folder"
          >
            Create folder
          </Button>
        </>
      }
    >
      <FormField
        label="Folder name"
        htmlFor="category-name"
        error={form.formState.errors.name?.message}
      >
        <input
          id="category-name"
          className="input"
          data-autofocus
          placeholder="For example, Finance"
          aria-invalid={!!form.formState.errors.name}
          {...form.register("name")}
        />
      </FormField>
      <div className="form-group">
        <span className="field-label">Accent color</span>
        <div
          className="color-options"
          role="radiogroup"
          aria-label="Folder accent color"
        >
          {colors.map((color) => (
            <label
              key={color}
              className="color-choice"
              style={{ "--choice-color": color } as React.CSSProperties}
              title={color}
            >
              <input
                type="radio"
                value={color}
                checked={selectedColor === color}
                {...form.register("color")}
              />
              <span className="sr-only">Choose {color}</span>
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}
