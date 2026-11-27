import { Link } from "react-router-dom";

export const PortalBrand = ({ to = "/dashboard" }: { to?: string }) => (
  <Link to={to} className="portal-brand" aria-label="User Portal home">
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M4 4h14v7h-7v17H4V4Zm24 24H14v-7h7V4h7v24Z"
        fill="currentColor"
      />
    </svg>
    <span>
      user<span className="portal-brand-light">portal</span>
      <span className="portal-brand-dot">.</span>
    </span>
  </Link>
);
