import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle">{description}</p>
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </header>
  );
}
