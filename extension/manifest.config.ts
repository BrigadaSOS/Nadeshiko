import { defineManifest } from '@crxjs/vite-plugin'
// @ts-ignore
import packageJson from './package.json'

const { version, name, description, displayName } = packageJson
// Convert from Semver (example: 0.1.0-beta6)
const [major, minor, patch, label = '0'] = version
  // can only contain digits, dots, or dash
  .replace(/[^\d.-]+/g, '')
  // split into version parts
  .split(/[.-]/)

export default defineManifest(async (env) => ({
  name: env.mode === 'staging' ? `[INTERNAL] ${name}` : displayName || name,
  description,
  // up to four numbers separated by dots
  version: `${major}.${minor}.${patch}.${label}`,
  // semver is OK in "version_name"
  version_name: version,
  manifest_version: 3,
  key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqztdqUpyxLnlGXjK5xrCE4jn73wd/u0MZjFGWMfvZyXEyYzDR4sjhaH0Faq8uZCOkKewbd8fUmvRjS50ztQmk6ZBr6VLCFeeoyRYZen65E8/nUnuwaJq/voPItc0SlMXx6pxcVToyNz9nuOZkiDyMQ02T2SuOBesRu+lkePKoI9RA8qnNLK8h5FFToaQYoNcY3u/ayYJeWe41eFJz20hN/VRuDWbA7KMMHoTpi+47fWZmdDzbcjy+g8YEqE8EZwYsaK0XoLNd422Nxu4CkI+Hwjj/1IHDm9wuHnpfCB847ic6LerKgChTuRm6NvlmBFQGhN6csilgR8ANd6BluSj4wIDAQAB',
  action: {
    default_popup: 'src/popup/index.html',
  },
  background: {
    service_worker: 'src/background/index.ts',
  },
  host_permissions: ['*://*.brigadasos.xyz/*'],
  options_page: 'src/options/index.html',
  permissions: [],
  web_accessible_resources: [],
  externally_connectable: {
    matches: ['https://*.brigadasos.xyz/*', '*://localhost/*']
  },
  "icons": {
    "16": "src/assets/16x16.png",
    "48": "src/assets/48x48.png",
    "64": "src/assets/64x64.png",
    "128": "src/assets/128x128.png"
  },
}))
