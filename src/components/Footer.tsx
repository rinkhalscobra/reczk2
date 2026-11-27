import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import Logo from './Logo';
import { CompanyRegistration } from './CompanyRegistration';
import { PUBLIC_SITE_URL } from '@/config/urls';

const Footer = () => {
  const { t } = useLanguage();

  return (
    <footer className="border-t border-border bg-card">
      <div className="container px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          <div>
            <Logo size="md" linkTo={PUBLIC_SITE_URL} />
            <p className="text-sm text-muted-foreground mt-4">{t('footer.description')}</p>
          </div>

          <div>
            <h3 className="font-semibold mb-4 text-primary">{t('footer.products')}</h3>
            <ul className="space-y-2">
              <li>
                <a href={`${PUBLIC_SITE_URL}/cryptocurrencies`} className="text-sm text-muted-foreground hover:text-primary">
                  {t('nav.cryptocurrencies')}
                </a>
              </li>
              <li>
                <a href={`${PUBLIC_SITE_URL}/exchanges`} className="text-sm text-muted-foreground hover:text-primary">
                  {t('nav.exchanges')}
                </a>
              </li>
              <li>
                <Link to="/watchlist" className="text-sm text-muted-foreground hover:text-primary">
                  {t('footer.watchlist')}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold mb-4 text-primary">{t('footer.company')}</h3>
            <ul className="space-y-2">
              <li>
                <a href={`${PUBLIC_SITE_URL}/about`} className="text-sm text-muted-foreground hover:text-primary">
                  {t('nav.about')}
                </a>
              </li>
              <li>
                <a href={`${PUBLIC_SITE_URL}/legal`} className="text-sm text-muted-foreground hover:text-primary">
                  {t('nav.legal')}
                </a>
              </li>
              <li>
                <a href={`${PUBLIC_SITE_URL}/disclaimer`} className="text-sm text-muted-foreground hover:text-primary">
                  {t('footer.disclaimer')}
                </a>
              </li>
              <li>
                <a href={`${PUBLIC_SITE_URL}/privacy`} className="text-sm text-muted-foreground hover:text-primary">
                  {t('footer.privacyPolicy')}
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold mb-4 text-primary">{t('footer.supportSection')}</h3>
            <ul className="space-y-2">
              <li>
                <a href={`${PUBLIC_SITE_URL}/contact`} className="text-sm text-muted-foreground hover:text-primary">
                  {t('nav.contact')}
                </a>
              </li>
              <li>
                <a href={`${PUBLIC_SITE_URL}/faq`} className="text-sm text-muted-foreground hover:text-primary">
                  {t('nav.faq')}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <CompanyRegistration compact className="mb-8" />
        <div className="border-t border-border pt-8">
          <p className="text-xs text-muted-foreground mb-4">
            <strong>{t('footer.disclaimer').toUpperCase()}:</strong> {t('footer.disclaimerText')}
          </p>

          <p className="text-xs text-muted-foreground mb-4">{t('footer.infoText')}</p>

          <p className="text-xs text-muted-foreground">{t('footer.paymentText')}</p>

          <p className="text-xs text-muted-foreground mt-4">{t('footer.copyright')}</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
