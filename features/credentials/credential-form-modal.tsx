"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { MagicWand01Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { Button, FormField, IconButton, Modal } from "@/components/ui";
import { KeyMintLoader } from "@/components/ui/keymint-loader";
import { Icon } from "@/components/icons";
import { credentialSchema } from "./schemas";
import {
  generatePassword,
  passwordEntropy,
  type GeneratorOptions,
} from "./password-generator";
import type { Category, Credential } from "@/types/vault";
import { useVaultData, useVaultMutations } from "@/features/vault/data";

type Form = z.input<typeof credentialSchema>;
type EditData = Partial<Credential> & { password?: string };
const EMPTY_FORM_VALUES: Form = {
  name: "",
  username: "",
  email: "",
  website: "",
  password: "",
  notes: "",
  categoryId: null,
  favorite: false,
};
const generatorLabels: Record<
  keyof Pick<
    GeneratorOptions,
    "uppercase" | "lowercase" | "numbers" | "symbols" | "excludeAmbiguous"
  >,
  string
> = {
  uppercase: "Uppercase",
  lowercase: "Lowercase",
  numbers: "Numbers",
  symbols: "Symbols",
  excludeAmbiguous: "Avoid ambiguous",
};

export function CredentialFormModal({
  open,
  onClose,
  edit,
}: {
  open: boolean;
  onClose: () => void;
  edit?: EditData;
}) {
  const [generator, setGenerator] = useState(false);
  const [options, setOptions] = useState<GeneratorOptions>({
    length: 20,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
    excludeAmbiguous: true,
  });
  const vault = useVaultData();
  const categories = { ...vault, data: vault.data?.categories as Category[] | undefined };
  const mutations = useVaultMutations();
  const form = useForm<Form>({
    resolver: zodResolver(credentialSchema),
    defaultValues: EMPTY_FORM_VALUES,
  });
  useEffect(() => {
    if (!open) {
      form.reset(EMPTY_FORM_VALUES);
      return;
    }
    form.reset({
      name: edit?.name ?? "",
      username: edit?.username ?? "",
      email: edit?.email ?? "",
      website: edit?.website ?? "",
      password: edit?.password ?? "",
      notes: edit?.notes ?? "",
      categoryId: edit?.categoryId ?? null,
      favorite: edit?.favorite ?? false,
    });
  }, [open, edit, form]);
  const entropy = passwordEntropy(options);
  const strength =
    entropy > 80 ? "Strong" : entropy > 50 ? "Moderate" : "Needs improvement";
  const strengthColor =
    entropy > 80
      ? "var(--success)"
      : entropy > 50
        ? "var(--warning)"
        : "var(--danger)";
  function closeAndClear() {
    form.reset(EMPTY_FORM_VALUES);
    setGenerator(false);
    onClose();
  }
  function generate() {
    try {
      form.setValue("password", generatePassword(options), {
        shouldValidate: true,
        shouldDirty: true,
      });
    } catch (error) {
      toast.error((error as Error).message);
    }
  }
  async function submit(values: Form) {
    try {
      const now = new Date().toISOString();
      await mutations.saveCredential({
        categoryId: values.categoryId ?? null,
        email: values.email ?? "",
        favorite: values.favorite ?? false,
        lastViewedAt: edit?.lastViewed ?? null,
        name: values.name,
        notes: values.notes ?? "",
        password: values.password,
        passwordUpdatedAt: edit?.password === values.password && edit.passwordUpdatedAt ? edit.passwordUpdatedAt : now,
        username: values.username,
        website: values.website ?? "",
      }, edit?.id);
      toast.success(edit?.id ? "Password updated" : "Password saved");
      closeAndClear();
    } catch (error) {
      toast.error((error as Error).message);
    }
  }
  const errors = form.formState.errors;
  return (
    <Modal
      open={open}
      onClose={closeAndClear}
      title={edit?.id ? "Edit password" : "Add a password"}
      description="Keymint encrypts this information before it is stored in your vault."
      large
      loading={form.formState.isSubmitting}
      loadingLabel={edit?.id ? "Updating password" : "Saving password"}
      footer={
        <>
          <Button onClick={closeAndClear}>Cancel</Button>
          <Button
            variant="primary"
            onClick={form.handleSubmit(submit)}
            disabled={form.formState.isSubmitting}
          >
            {edit?.id ? "Save changes" : "Save password"}
          </Button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={form.handleSubmit(submit)}
        noValidate
        aria-busy={
          form.formState.isSubmitting || categories.isFetching
            ? "true"
            : undefined
        }
      >
        <div className="form-grid">
          <FormField
            label="Name"
            htmlFor="credential-name"
            error={errors.name?.message}
          >
            <input
              id="credential-name"
              className="input"
              data-autofocus
              placeholder="For example, Personal Gmail"
              aria-invalid={!!errors.name}
              {...form.register("name")}
            />
          </FormField>
          <FormField
            label="Username"
            htmlFor="credential-username"
            error={errors.username?.message}
          >
            <input
              id="credential-username"
              className="input"
              placeholder="Username or account ID"
              aria-invalid={!!errors.username}
              {...form.register("username")}
            />
          </FormField>
          <FormField
            label="Email"
            htmlFor="credential-email"
            error={errors.email?.message}
          >
            <input
              id="credential-email"
              className="input"
              type="email"
              placeholder="you@example.com"
              aria-invalid={!!errors.email}
              {...form.register("email")}
            />
          </FormField>
          <FormField
            label="Website"
            htmlFor="credential-website"
            error={errors.website?.message}
          >
            <input
              id="credential-website"
              className="input"
              type="url"
              placeholder="https://example.com"
              aria-invalid={!!errors.website}
              {...form.register("website")}
            />
          </FormField>
        </div>
        <FormField
          label="Password"
          htmlFor="credential-password"
          error={errors.password?.message}
        >
          <div className="password-input-group">
            <input
              id="credential-password"
              className="input"
              type="text"
              autoComplete="new-password"
              spellCheck={false}
              aria-invalid={!!errors.password}
              {...form.register("password")}
            />
            <Button
              type="button"
              icon={<Icon icon={MagicWand01Icon} size={17} />}
              onClick={() => {
                setGenerator(!generator);
                if (!form.getValues("password")) generate();
              }}
            >
              Generate
            </Button>
          </div>
        </FormField>
        {generator && (
          <div className="generator-panel">
            <div className="generator-line">
              <label htmlFor="password-length" className="field-label">
                Length <strong>{options.length}</strong>
              </label>
              <input
                id="password-length"
                type="range"
                min="12"
                max="64"
                value={options.length}
                onChange={(event) =>
                  setOptions({ ...options, length: Number(event.target.value) })
                }
              />
              <IconButton
                type="button"
                className="btn-icon"
                label="Generate another password"
                onClick={generate}
              >
                <Icon icon={RefreshIcon} size={18} />
              </IconButton>
            </div>
            <div className="generator-options">
              {(
                Object.keys(generatorLabels) as Array<
                  keyof typeof generatorLabels
                >
              ).map((key) => (
                <label className="check-row" key={key}>
                  <input
                    type="checkbox"
                    checked={options[key]}
                    onChange={(event) =>
                      setOptions({ ...options, [key]: event.target.checked })
                    }
                  />
                  {generatorLabels[key]}
                </label>
              ))}
            </div>
            <div>
              <div className="strength-track">
                <span
                  style={{
                    width: `${Math.min(100, entropy)}%`,
                    background: strengthColor,
                  }}
                />
              </div>
              <p className="strength-copy">
                {entropy} bits of estimated entropy · {strength}
              </p>
            </div>
          </div>
        )}
        <div className="form-grid">
          <FormField label="Folder" htmlFor="credential-category">
            {categories.isFetching && (
              <KeyMintLoader
                className="loading-status-inline"
                size="sm"
                variant="inline"
                label="Loading folders for this password"
                showLabel
              />
            )}
            <select
              id="credential-category"
              className="select"
              disabled={categories.isPending}
              aria-busy={categories.isPending ? "true" : undefined}
              {...form.register("categoryId", {
                setValueAs: (value) => value || null,
              })}
            >
              <option value="">No folder</option>
              {categories.data?.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {categories.isError && (
              <span className="field-error" role="alert">
                Folders could not be loaded. You can still save without one.
              </span>
            )}
          </FormField>
          <div className="form-group">
            <span className="field-label">Options</span>
            <label className="check-row">
              <input type="checkbox" {...form.register("favorite")} />
              Add to favorites
            </label>
          </div>
        </div>
        <FormField label="Secure notes" htmlFor="credential-notes">
          <textarea
            id="credential-notes"
            className="textarea"
            placeholder="Optional notes stored alongside this password"
            {...form.register("notes")}
          />
        </FormField>
      </form>
    </Modal>
  );
}
