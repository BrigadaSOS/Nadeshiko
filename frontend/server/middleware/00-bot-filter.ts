const JUNK_EXTENSIONS = /\.(php|asp|aspx|jsp|cgi|env|sql|xvy|bak|swp|orig|pem|key)$/i;

const SCANNER_PATHS = [
  '/wp-login',
  '/wp-admin',
  '/wp-content',
  '/wp-includes',
  '/xmlrpc',
  '/phpmyadmin',
  '/wp-config',
  '/wlwmanifest',
  '/.env',
  '/.git',
  '/.aws',
  '/.svn',
  '/.config',
  '/.htaccess',
  '/.htpasswd',
  '/.DS_Store',
];

const MAX_PATH_LENGTH = 300;

export default defineEventHandler((event) => {
  const path = event.path?.split('?')[0] || '';

  if (
    path.length > MAX_PATH_LENGTH ||
    JUNK_EXTENSIONS.test(path) ||
    SCANNER_PATHS.some((p) => path.includes(p))
  ) {
    setResponseStatus(event, 404);
    return '';
  }
});
