import { LogoMark } from "../logo";

export type KeyMintLoaderProps = {
  size?: "sm" | "md" | "lg";
  variant?: "inline" | "section" | "page" | "overlay";
  label?: string;
  className?: string;
  showLabel?: boolean;
};

export function KeyMintLoader({
  size = "md",
  variant = "section",
  label = "Securing your request",
  className = "",
  showLabel = variant !== "inline",
}: KeyMintLoaderProps) {
  return (
    <div
      className={`keymint-loader keymint-loader--${variant} keymint-loader--${size} ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-label={label}
      aria-busy={variant === "section" || variant === "page" ? "true" : undefined}
    >
      <span className="keymint-loader__mark" aria-hidden="true">
        <LogoMark size={56} />
      </span>
      <span className={showLabel ? "keymint-loader__label" : "sr-only"}>
        {label}
      </span>
    </div>
  );
}
