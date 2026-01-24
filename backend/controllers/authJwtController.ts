import type { Logout } from 'generated/routes/authjwt';

export const logout: Logout = async (_params, respond, _req, res) => {
  res.clearCookie('access_token');

  return respond.with200().body({
    message: 'Logout successfully.',
  });
};
