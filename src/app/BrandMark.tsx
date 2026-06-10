import { BRAND } from "@/lib/brand";

// Eolax wordmark. Swap the text for an <img src={BRAND.logoSrc}> once real
// brand assets exist (set BRAND.logoSrc in src/lib/brand.ts).
export default function BrandMark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  if (BRAND.logoSrc) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={BRAND.logoSrc} alt={BRAND.name} className={`brandmark ${size}`} />;
  }
  return (
    <span className={`brandmark wordmark ${size}`}>
      <span className="brandmark-dot" aria-hidden />
      {BRAND.shortName}
    </span>
  );
}
