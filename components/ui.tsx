"use client";

import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useId, useRef } from "react";
import { Icon } from "./icons";
import { KeyMintLoader } from "./ui/keymint-loader";

type ButtonVariant = "default" | "primary" | "danger" | "ghost";

export function Button({
  variant = "default",
  icon,
  loading = false,
  loadingLabel = "Processing secure request",
  className = "",
  disabled,
  children,
  "aria-busy": ariaBusy,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon?: React.ReactNode;
  loading?: boolean;
  loadingLabel?: string;
}) {
  const variantClass =
    variant === "primary"
      ? "btn-primary"
      : variant === "danger"
        ? "btn-danger"
        : variant === "ghost"
          ? "btn-ghost"
          : "";
  return (
    <button
      className={`btn ${variantClass} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || ariaBusy === true ? "true" : undefined}
      {...props}
    >
      <span className={`btn-content ${loading ? "btn-content-hidden" : ""}`}>
        {icon}
        {children}
      </span>
      {loading && (
        <span className="btn-loading">
          <KeyMintLoader
            size="sm"
            variant="inline"
            label={loadingLabel}
          />
        </span>
      )}
    </button>
  );
}

export function IconButton({
  label,
  loading = false,
  loadingLabel = label,
  className = "",
  disabled,
  children,
  "aria-busy": ariaBusy,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  loading?: boolean;
  loadingLabel?: string;
}) {
  return (
    <button
      className={`action-button ${className}`.trim()}
      aria-label={loading ? loadingLabel : label}
      title={label}
      disabled={disabled || loading}
      aria-busy={loading || ariaBusy === true ? "true" : undefined}
      {...props}
    >
      {loading ? (
        <KeyMintLoader size="sm" variant="inline" label={loadingLabel} />
      ) : (
        children
      )}
    </button>
  );
}

export function SearchField({
  className = "",
  "aria-label": ariaLabel,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`search-field ${className}`.trim()}>
      <Icon icon={Search01Icon} size={18} />
      <input
        aria-label={ariaLabel ?? props.placeholder ?? "Search"}
        {...props}
      />
    </div>
  );
}

export function FormField({
  label,
  labelSuffix,
  htmlFor,
  error,
  description,
  children,
}: {
  label: React.ReactNode;
  labelSuffix?: React.ReactNode;
  htmlFor: string;
  error?: string;
  description?: string;
  children: React.ReactNode;
}) {
  const descriptionId = `${htmlFor}-description`;
  const errorId = `${htmlFor}-error`;
  return (
    <div className="form-group">
      {labelSuffix ? (
        <div className="field-label field-label-with-suffix">
          <label htmlFor={htmlFor}>{label}</label>
          {labelSuffix}
        </div>
      ) : (
        <label htmlFor={htmlFor}>{label}</label>
      )}
      {children}
      {description && <small id={descriptionId}>{description}</small>}
      {error && (
        <span id={errorId} className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  large = false,
  loading = false,
  loadingLabel = "Completing secure operation",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  large?: boolean;
  loading?: boolean;
  loadingLabel?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const priorFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => {
      const initialFocus = dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]")
        ?? dialogRef.current?.querySelector<HTMLElement>(
          "input:not([type=hidden]), select, textarea, button:not([disabled])",
        );
      initialFocus?.focus();
    }, 0);
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!loading) onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", keyboard);
      document.body.style.overflow = previousOverflow;
      priorFocus?.focus();
    };
  }, [open, loading]);

  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) =>
        !loading && event.target === event.currentTarget && onClose()
      }
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={loading ? "true" : undefined}
        className={`modal ${large ? "modal-lg" : ""}`}
      >
        <div className="modal-header">
          <div className="modal-header-copy">
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <IconButton label="Close dialog" onClick={onClose} disabled={loading}>
            <Icon icon={Cancel01Icon} size={19} />
          </IconButton>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
        {loading && (
          <KeyMintLoader
            size="md"
            variant="overlay"
            label={loadingLabel}
          />
        )}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="card empty-state">
      <div>
        <div className="empty-orbit">{icon}</div>
        <h2>{title}</h2>
        <p>{children}</p>
        {action}
      </div>
    </div>
  );
}

export function Alert({
  variant = "info",
  children,
}: {
  variant?: "info" | "danger";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`alert alert-${variant}`}
      role={variant === "danger" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "Request failed");
  return payload.data as T;
}
