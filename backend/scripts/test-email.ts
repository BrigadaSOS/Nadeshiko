import { sendTestEmail, TEST_EMAIL_TEMPLATES, type TestEmailTemplate } from '@app/mailers/email';

// Read from the mailer rather than restated here, so a template added there
// is previewable without anybody remembering to update this list.
const VALID_TEMPLATES: readonly TestEmailTemplate[] = TEST_EMAIL_TEMPLATES;

const template = (process.argv[2] as TestEmailTemplate) || 'welcome';
const to = process.argv[3] || 'test@example.com';

if (!VALID_TEMPLATES.includes(template)) {
  console.error(`Invalid template "${template}". Valid options: ${VALID_TEMPLATES.join(', ')}`);
  process.exit(1);
}

console.log(`Sending "${template}" email to ${to}...`);

const { previewUrl } = await sendTestEmail(template, to);

if (previewUrl) {
  console.log(`\nPreview URL: ${previewUrl}`);
} else {
  console.log('\nEmail sent (no preview URL in non-local environments).');
}

process.exit(0);
