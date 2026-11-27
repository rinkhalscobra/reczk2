import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Menu, Search, Bell, ChevronDown, User, LayoutDashboard, Wallet, FileText, HeadphonesIcon, LogOut, Shield, Users, MessageCircle, BadgeDollarSign, type LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useAdmin } from "@/hooks/useAdmin";
import { useLanguage } from "@/contexts/LanguageContext";
import { useUnreadCounts } from "@/hooks/useUnreadCounts";
import Logo from "./Logo";
import LanguageSelector from "./LanguageSelector";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { PUBLIC_SITE_URL } from '@/config/urls';
import { publicContactEmail } from '@/lib/contactEmail';

interface NavigationProps {
  landing?: boolean;
}

const Navigation = ({ landing = false }: NavigationProps) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, signOut } = useAuth();
  const { userRole, loading: roleLoading } = useAdmin();
  const { t } = useLanguage();
  const { messages: unreadMessages, notifications: unreadNotifications } = useUnreadCounts();
  const contactEmail = user ? publicContactEmail(user) : '';

  const isStaff = userRole === 'admin' || userRole === 'group_admin' || userRole === 'supervisor' || userRole === 'agent';

  const getDashboardLink = () => {
    if (userRole === 'admin') return '/admin';
    if (userRole === 'group_admin') return '/group-admin';
    if (userRole === 'supervisor') return '/supervisor';
    if (userRole === 'agent') return '/agent';
    return '/dashboard';
  };

  const closeMobileMenu = () => setMobileMenuOpen(false);

  // Public navigation links
  const publicLinks = [
    { to: `${PUBLIC_SITE_URL}/cryptocurrencies`, label: t('nav.cryptocurrencies') },
    { to: `${PUBLIC_SITE_URL}/categories`, label: t('nav.categories') },
    { to: `${PUBLIC_SITE_URL}/exchanges`, label: t('nav.exchanges') },
    { to: `${PUBLIC_SITE_URL}/news`, label: t('nav.news') },
  ];

  const publicMoreLinks = [
    { to: `${PUBLIC_SITE_URL}/about`, label: t('nav.about') },
    { to: `${PUBLIC_SITE_URL}/legal`, label: t('nav.legal') },
    { to: `${PUBLIC_SITE_URL}/faq`, label: t('nav.faq') },
    { to: `${PUBLIC_SITE_URL}/contact`, label: t('nav.contact') },
  ];

  const landingLinks = [
    { target: "recovery", label: "Recovery" },
    { target: "located-funds", label: "Located Funds" },
    { target: "cases", label: "Cases" },
    { target: "pricing", label: "Pricing" },
    { target: "contact", label: "Contact" },
  ];

  // Authenticated user links
  const userLinks: Array<{ to: string; label: string; icon: LucideIcon; badge?: number }> = [
    { to: "/dashboard", label: t('nav.dashboard'), icon: LayoutDashboard },
    { to: "/dashboard/messages", label: t('nav.messages'), icon: MessageCircle, badge: unreadMessages },
    { to: "/dashboard/funds", label: "Located Funds", icon: BadgeDollarSign },
    { to: "/dashboard/wallet", label: t('nav.wallet'), icon: Wallet },
    { to: "/dashboard/transactions", label: t('nav.transactions'), icon: FileText },
    { to: "/dashboard/case", label: t('nav.myCase'), icon: Shield },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/40 backdrop-blur-xl supports-[backdrop-filter]:bg-background/30">
      <div className="container px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between sm:h-28">
          <Logo size="md" />

          {landing && (
            <div className="hidden md:flex items-center gap-6">
              {landingLinks.map(link => (
                <a
                  key={link.target}
                  href={`#${link.target}`}
                  className="text-sm text-foreground hover:text-primary transition-colors"
                >
                  {link.label}
                </a>
              ))}
            </div>
          )}

          {/* Public Navigation (Unauthenticated or basic browsing) - Desktop */}
          {!landing && !user && (
            <div className="hidden md:flex items-center gap-6">
              {publicLinks.map(link => (
                <a key={link.to} href={link.to} className="text-sm text-foreground hover:text-primary transition-colors">
                  {link.label}
                </a>
              ))}
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-1 text-sm text-foreground hover:text-primary transition-colors">
                  {t('nav.more')}
                  <ChevronDown className="h-3 w-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="bg-card border-border">
                  {publicMoreLinks.map(link => (
                    <DropdownMenuItem key={link.to} asChild>
                      <a href={link.to} className="cursor-pointer">{link.label}</a>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/* Authenticated User Navigation - Desktop */}
          {!landing && user && !isStaff && (
            <div className="hidden md:flex items-center gap-6">
              {userLinks.map(link => (
                <Link key={link.to} to={link.to} className="text-sm text-foreground hover:text-primary transition-colors flex items-center gap-1 relative">
                  <link.icon className="h-4 w-4" />
                  {link.label}
                  {Boolean(link.badge && link.badge > 0) && (
                    <Badge className="absolute -top-2 -right-4 h-4 min-w-4 p-0 flex items-center justify-center text-[10px] bg-destructive">
                      {link.badge}
                    </Badge>
                  )}
                </Link>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 sm:gap-3">
            {!isStaff && <LanguageSelector />}
            {!isStaff && (
              <Button variant="ghost" size="icon" className="hidden sm:inline-flex">
                <Search className="h-5 w-5" />
              </Button>
            )}
            
            {user ? (
              <>
                {/* Notifications */}
                {!isStaff && (
                  <Button variant="ghost" size="icon" asChild>
                    <Link to="/dashboard/notifications" className="relative">
                      <Bell className="h-5 w-5 text-foreground" />
                      {unreadNotifications > 0 && (
                        <Badge className="absolute -top-1 -right-1 h-4 min-w-4 p-0 flex items-center justify-center text-[10px] bg-destructive">
                          {unreadNotifications > 9 ? '9+' : unreadNotifications}
                        </Badge>
                      )}
                    </Link>
                  </Button>
                )}

                {/* User Menu Dropdown - Desktop */}
                <div className="hidden md:block">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="relative">
                        <User className="h-5 w-5" />
                        {isStaff && (
                          <Badge className="absolute -top-1 -right-1 h-4 w-4 p-0 flex items-center justify-center text-[10px] bg-primary">
                            {userRole?.charAt(0).toUpperCase()}
                          </Badge>
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 bg-card border-border">
                      <div className="px-3 py-2 border-b border-border">
                        <p className="text-sm font-medium truncate">{contactEmail}</p>
                        {userRole && (
                          <Badge variant="outline" className="mt-1 text-xs capitalize">
                            {userRole}
                          </Badge>
                        )}
                      </div>
                      <DropdownMenuItem asChild>
                        <Link to={getDashboardLink()} className="cursor-pointer flex items-center gap-2">
                          <LayoutDashboard className="h-4 w-4" />
                          {t('nav.dashboard')}
                        </Link>
                      </DropdownMenuItem>
                      {!isStaff && (
                        <>
                          <DropdownMenuItem asChild>
                            <Link to="/dashboard/funds" className="cursor-pointer flex items-center gap-2">
                              <BadgeDollarSign className="h-4 w-4" />
                              Located Funds
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link to="/dashboard/wallet" className="cursor-pointer flex items-center gap-2">
                              <Wallet className="h-4 w-4" />
                              {t('nav.wallet')}
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link to="/dashboard/case" className="cursor-pointer flex items-center gap-2">
                              <Shield className="h-4 w-4" />
                              {t('nav.myCase')}
                            </Link>
                          </DropdownMenuItem>
                        </>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        className="cursor-pointer flex items-center gap-2 text-destructive focus:text-destructive"
                        onClick={() => signOut()}
                      >
                        <LogOut className="h-4 w-4" />
                        {t('nav.signOut')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </>
            ) : (
              <>
                <Button variant="ghost" asChild className="hidden sm:inline-flex">
                  <Link to="/auth">{t('nav.login')}</Link>
                </Button>
                <Button asChild className="hidden sm:inline-flex">
                  <Link to="/auth">{t('nav.getStarted')}</Link>
                </Button>
              </>
            )}
            
            {/* Mobile Menu Button */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[280px] sm:w-[320px] bg-card">
                <SheetHeader>
                  <SheetTitle className="text-left">
                    <Logo size="sm" linkTo={undefined} />
                  </SheetTitle>
                </SheetHeader>
                <div className="mt-6 flex flex-col gap-4">
                  {/* User Info (if logged in) */}
                  {user && (
                    <div className="pb-4 border-b border-border">
                      <p className="text-sm font-medium truncate">{contactEmail}</p>
                      {userRole && (
                        <Badge variant="outline" className="mt-1 text-xs capitalize">
                          {userRole}
                        </Badge>
                      )}
                    </div>
                  )}

                  {/* Navigation Links */}
                  <div className="flex flex-col gap-1">
                    {landing && landingLinks.map(link => (
                      <a
                        key={link.target}
                        href={`#${link.target}`}
                        onClick={closeMobileMenu}
                        className="flex items-center gap-3 px-3 py-3 rounded-lg text-foreground hover:bg-secondary transition-colors"
                      >
                        {link.label}
                      </a>
                    ))}

                    {!landing && !user && (
                      <>
                        {publicLinks.map(link => (
                          <a
                            key={link.to}
                            href={link.to}
                            onClick={closeMobileMenu}
                            className="flex items-center gap-3 px-3 py-3 rounded-lg text-foreground hover:bg-secondary transition-colors"
                          >
                            {link.label}
                          </a>
                        ))}
                        <div className="pt-2 pb-1">
                          <span className="px-3 text-xs text-muted-foreground uppercase tracking-wide">{t('nav.more')}</span>
                        </div>
                        {publicMoreLinks.map(link => (
                          <a
                            key={link.to}
                            href={link.to}
                            onClick={closeMobileMenu}
                            className="flex items-center gap-3 px-3 py-3 rounded-lg text-foreground hover:bg-secondary transition-colors"
                          >
                            {link.label}
                          </a>
                        ))}
                      </>
                    )}

                    {!landing && user && !isStaff && userLinks.map(link => (
                      <Link
                        key={link.to}
                        to={link.to}
                        onClick={closeMobileMenu}
                        className="flex items-center gap-3 px-3 py-3 rounded-lg text-foreground hover:bg-secondary transition-colors"
                      >
                        <link.icon className="h-5 w-5" />
                        {link.label}
                      </Link>
                    ))}

                  </div>

                  {/* Auth Actions */}
                  <div className="pt-4 border-t border-border flex flex-col gap-2">
                    {user ? (
                      <Button 
                        variant="destructive" 
                        className="w-full justify-start gap-2"
                        onClick={() => {
                          signOut();
                          closeMobileMenu();
                        }}
                      >
                        <LogOut className="h-4 w-4" />
                        {t('nav.signOut')}
                      </Button>
                    ) : (
                      <>
                        <Button asChild variant="outline" className="w-full">
                          <Link to="/auth" onClick={closeMobileMenu}>{t('nav.login')}</Link>
                        </Button>
                        <Button asChild className="w-full">
                          <Link to="/auth" onClick={closeMobileMenu}>{t('nav.getStarted')}</Link>
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;
