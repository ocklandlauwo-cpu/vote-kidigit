// PUB-01 to PUB-05 frame (App Flow 4.1, Design System 10.11): site header with navigation,
// language and theme switches, the page, and the footer. On small screens the navigation opens
// as a full-width panel.
import { CloseOutlined, MenuOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Logo } from '../../components/Logo';
import { ThemeToggle } from '../../components/ThemeToggle';
import { setPublicLanguage, usePublicText } from './publicText';

const NAV = [
  { to: '/features', key: 'nav.features' },
  { to: '/pricing', key: 'nav.pricing' },
  { to: '/contact', key: 'nav.contact' },
] as const;

/** The staff portal is a separate app under /app (Tech Stack 7). */
const SIGN_IN_URL = '/app/';

export default function PublicLayout() {
  const { t, language } = usePublicText();
  const { pathname } = useLocation();
  // The menu belongs to the page it was opened on: navigating closes it.
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menuOpen = menuPath === pathname;
  const setMenuOpen = (open: boolean) => setMenuPath(open ? pathname : null);

  // Show the top of each new page.
  useEffect(() => {
    globalThis.scrollTo?.(0, 0);
  }, [pathname]);

  // The page language follows the switch; voter screens are Swahili again after leaving.
  useEffect(() => {
    document.documentElement.lang = language;
    return () => {
      document.documentElement.lang = 'sw';
    };
  }, [language]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuPath(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const languageButton = (large: boolean) => (
    <button
      type="button"
      lang={language === 'sw' ? 'en' : 'sw'}
      aria-label={t('nav.changeLanguage')}
      onClick={() => setPublicLanguage(language === 'sw' ? 'en' : 'sw')}
      className={`inline-flex ${large ? 'min-h-12 px-4' : 'min-h-10 px-3'} items-center rounded-md text-label font-medium text-text-secondary transition-colors duration-(--vk-duration-fast) hover:bg-surface-muted hover:text-text`}
    >
      {t('nav.otherLanguage')}
    </button>
  );

  return (
    <div className="vk-site flex min-h-dvh flex-col bg-bg text-text">
      <a href="#main" className="vk-skip-link">
        {t('nav.skip')}
      </a>
      <header className="vk-site-header">
        <div className="mx-auto flex h-full max-w-300 items-center gap-6 px-4 md:px-6">
          <Link to="/" aria-label={t('nav.homeLink')} className="inline-flex">
            <Logo lockup="horizontal-large" />
          </Link>
          <nav aria-label={t('nav.label')} className="vk-site-nav hidden flex-1 gap-6 lg:flex">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to}>
                {t(item.key)}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-2 lg:flex">
            {languageButton(false)}
            <ThemeToggle />
            <a href={SIGN_IN_URL} className="vk-btn vk-btn--tertiary vk-btn--m">
              {t('nav.signIn')}
            </a>
            <Link to="/vote" className="vk-btn vk-btn--secondary vk-btn--m">
              {t('nav.vote')}
            </Link>
            <Link to="/demo" className="vk-btn vk-btn--primary vk-btn--m">
              {t('nav.demo')}
            </Link>
          </div>
          <div className="ml-auto flex items-center lg:hidden">
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-controls="site-menu"
              aria-label={menuOpen ? t('nav.closeMenu') : t('nav.openMenu')}
              onClick={() => setMenuOpen(!menuOpen)}
              className="inline-flex size-12 items-center justify-center rounded-md text-text-secondary hover:bg-surface-muted hover:text-text"
            >
              {menuOpen ? <CloseOutlined aria-hidden /> : <MenuOutlined aria-hidden />}
            </button>
          </div>
        </div>
      </header>
      {menuOpen && (
        <div id="site-menu" className="vk-site-menu lg:hidden">
          <nav aria-label={t('nav.label')} className="flex flex-col gap-1">
            {[{ to: '/', key: 'nav.home' } as const, ...NAV].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className="flex min-h-12 items-center rounded-md px-3 text-body-lg font-medium hover:bg-surface-muted"
              >
                {t(item.key)}
              </NavLink>
            ))}
          </nav>
          <div className="mt-6 flex flex-col gap-3">
            <Link to="/demo" className="vk-btn vk-btn--primary w-full">
              {t('nav.demo')}
            </Link>
            <Link to="/vote" className="vk-btn vk-btn--secondary w-full">
              {t('nav.vote')}
            </Link>
            <a href={SIGN_IN_URL} className="vk-btn vk-btn--tertiary w-full">
              {t('nav.signIn')}
            </a>
            <div className="flex items-center justify-center gap-2">
              {languageButton(true)}
              <ThemeToggle />
            </div>
          </div>
        </div>
      )}
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}

function SiteFooter() {
  const { t } = usePublicText();
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto grid max-w-300 gap-8 px-4 py-12 md:grid-cols-3 md:px-6">
        <div className="flex flex-col gap-3">
          <Logo lockup="horizontal-small" />
          <p className="text-body-sm text-text-secondary">{t('footer.tagline')}</p>
        </div>
        <div>
          <h2 className="text-label font-semibold">{t('footer.pagesTitle')}</h2>
          <ul className="mt-3 flex flex-col gap-2 text-body-sm text-text-secondary">
            {(
              [
                ['/features', 'nav.features'],
                ['/pricing', 'nav.pricing'],
                ['/contact', 'nav.contact'],
                ['/demo', 'nav.demo'],
                ['/vote', 'nav.vote'],
              ] as const
            ).map(([to, key]) => (
              <li key={to}>
                <Link to={to} className="hover:text-text">
                  {t(key)}
                </Link>
              </li>
            ))}
            <li>
              <a href={SIGN_IN_URL} className="hover:text-text">
                {t('nav.signIn')}
              </a>
            </li>
          </ul>
        </div>
        <div>
          <h2 className="text-label font-semibold">{t('footer.contactTitle')}</h2>
          <ul className="mt-3 flex flex-col gap-2 text-body-sm text-text-secondary">
            <li className="select-text">{t('contact.phone')}</li>
            <li className="select-text">{t('contact.email')}</li>
            <li>{t('contact.address')}</li>
          </ul>
        </div>
      </div>
      <p className="mx-auto max-w-300 px-4 pb-8 text-caption text-text-tertiary md:px-6">
        {t('footer.copyright', { year: new Date().getFullYear() })}
      </p>
    </footer>
  );
}
