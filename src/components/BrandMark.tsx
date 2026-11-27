interface BrandMarkProps {
  className?: string;
}

const BrandMark = ({ className = '' }: BrandMarkProps) => (
  <span className={`whitespace-nowrap font-serif font-semibold tracking-[-0.02em] ${className}`}>
    User Portal
  </span>
);

export default BrandMark;
