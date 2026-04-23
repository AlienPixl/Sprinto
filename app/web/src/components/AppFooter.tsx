const PUBLIC_REPOSITORY_URL = "https://github.com/AlienPixl/Sprinto";
const PUBLIC_LICENSE_URL = `${PUBLIC_REPOSITORY_URL}/blob/main/LICENSE`;

type AppFooterProps = {
  copyrightLabel: string;
  footerCurrentVersion: string;
  footerUpdateUrl: string;
  footerUpdateVersion: string;
  showFooterCurrentVersion: boolean;
  showFooterUpdateNotice: boolean;
};

export function AppFooter({
  copyrightLabel,
  footerCurrentVersion,
  footerUpdateUrl,
  footerUpdateVersion,
  showFooterCurrentVersion,
  showFooterUpdateNotice,
}: AppFooterProps) {
  return (
    <footer className="app-footer">
      <div className="app-footer__content">
        <div className="app-footer__legal">
          <a
            className="app-footer__link"
            href={PUBLIC_LICENSE_URL}
            rel="noreferrer"
            target="_blank"
          >
            License
          </a>
          <span className="app-footer__copyright">© {copyrightLabel}</span>
        </div>
        <div className="app-footer__meta">
          <span className="app-footer__brand">Sprinto by Martin Janeček</span>
          <span aria-hidden="true" className="app-footer__separator">|</span>
          <a
            className="app-footer__link"
            href={PUBLIC_REPOSITORY_URL}
            rel="noreferrer"
            target="_blank"
          >
            GitHub
          </a>
        </div>
        {showFooterUpdateNotice ? (
          <div className="app-footer__status">
            {footerUpdateUrl ? (
              <a
                className="app-footer__update"
                href={footerUpdateUrl}
                rel="noreferrer"
                target="_blank"
              >
                New version {footerUpdateVersion} available
              </a>
            ) : (
              <span className="app-footer__update">New version {footerUpdateVersion} available</span>
            )}
          </div>
        ) : showFooterCurrentVersion ? (
          <div className="app-footer__status">
            <span className="app-footer__version">Current version {footerCurrentVersion}</span>
          </div>
        ) : null}
      </div>
    </footer>
  );
}
