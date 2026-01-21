import { logger } from './log';

export const sendConfirmationEmail = async (username: string, email: string, _token: string) => {
  // TODO: Pending implementation of email verification
  logger.info({ email, username }, 'Email verification pending implementation');
};
