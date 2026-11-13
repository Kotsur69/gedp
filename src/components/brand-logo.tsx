import Image from "next/image";

// Official ArcelorMittal primary logo, tightly cropped (same file as AMSteel_Quote logo-color.svg).
// Intrinsic size from the SVG viewBox "58 58 558 236".
const LOGO_WIDTH = 558;
const LOGO_HEIGHT = 236;

type BrandLogoProps = {
  className?: string;
  priority?: boolean;
};

export function BrandLogo({ className, priority = false }: BrandLogoProps) {
  return (
    <Image
      src="/brand/logo.svg"
      alt="ArcelorMittal"
      width={LOGO_WIDTH}
      height={LOGO_HEIGHT}
      priority={priority}
      className={className}
    />
  );
}
