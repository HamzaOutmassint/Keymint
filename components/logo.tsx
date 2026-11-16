import Image from "next/image";

export function LogoMark({ size = 44 }: { size?: number }) {
  return <Image src="/logo.png" alt="" width={size} height={size} />;
}

export function Logo() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        <LogoMark size={36} />
      </span>
      <span className="brand-copy">
        <span className="brand-name">Keymint</span>
        <span className="brand-sub">Private vault</span>
      </span>
    </div>
  );
}
