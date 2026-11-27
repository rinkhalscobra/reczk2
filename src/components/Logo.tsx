import { Link } from 'react-router-dom';
import BrandMark from '@/components/BrandMark';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  linkTo?: string;
}

const sizeConfig = {
  sm: 'text-base sm:text-lg',
  md: 'text-lg sm:text-xl',
  lg: 'text-xl sm:text-2xl',
};

export const Logo = ({ size = 'md', linkTo = '/' }: LogoProps) => {
  const content = <BrandMark className={`${sizeConfig[size]} shrink-0`} />;

  if (linkTo) {
    return (
      <Link to={linkTo} className="inline-flex shrink-0 items-center hover:opacity-90 transition-opacity">
        {content}
      </Link>
    );
  }

  return content;
};

export default Logo;
