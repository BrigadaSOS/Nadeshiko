import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import DiscordOauth2 from 'discord-oauth2';
import { AppDataSource } from '@config/database';
import { User, UserRole, UserAuth } from '@app/entities';
import { createToken, maxAgeJWT } from '@app/middleware/authentication';
import { sendConfirmationEmail } from '@lib/utils/email';
import { logger } from '@lib/utils/log';
import {
  UserNotFoundError,
  AccountConflictError,
  InvalidCredentialsError,
  EmailNotVerifiedError,
  AuthCredentialsExpiredError,
} from '@lib/utils/apiErrors';
import type { Login, Register, LoginGoogle, GetDiscordAuthUrl, LoginDiscord } from 'generated/routes/auth';

const userRepository = AppDataSource.getRepository(User);
const userRoleRepository = AppDataSource.getRepository(UserRole);
const userAuthRepository = AppDataSource.getRepository(UserAuth);

export const login: Login = async ({ body }, respond, _req, res) => {
  const user = await userRepository.findOne({
    where: { email: body.email },
    relations: {
      userAuths: true,
      userRoles: true,
    },
  });

  if (!user || !user.isActive) {
    throw new UserNotFoundError();
  }

  if (user.userAuths && user.userAuths.length > 0) {
    throw new AccountConflictError(
      `This email is registered with ${user.userAuths[0].provider}. Please log in using ${user.userAuths[0].provider}.`,
    );
  }

  const passwordValid = await Bun.password.verify(body.password.toString(), user.password!);
  if (!passwordValid) {
    throw new InvalidCredentialsError();
  }

  if (user.isVerified === false) {
    throw new EmailNotVerifiedError();
  }

  const user_role = await userRoleRepository.find({
    where: { user: { id: user.id } },
    relations: {
      role: true,
    },
  });

  const list_roles = user_role.map((ur) => ur.roleId);
  const token = createToken(user.id, list_roles);

  res.cookie('access_token', token, {
    expires: new Date(Date.now() + maxAgeJWT * 1000),
    httpOnly: true,
    secure: true,
    sameSite: 'none',
  });

  return respond.with200().body({
    message: `Successful login, ${user.username}`,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      roles: user.userRoles?.map((ur) => ({ id_role: ur.roleId })) || [],
    },
    token: token,
  });
};

export const register: Register = async ({ body }, respond) => {
  const oldUser = await userRepository.findOne({
    where: { email: body.email },
    relations: {
      userAuths: true,
    },
  });

  if (oldUser) {
    if (oldUser.userAuths && oldUser.userAuths.length > 0) {
      throw new AccountConflictError(
        `This email is already registered with ${oldUser.userAuths[0].provider}. Please log in using ${oldUser.userAuths[0].provider}.`,
      );
    } else {
      throw new AccountConflictError('This email is already registered. Please log in or use a different email.');
    }
  }

  const encryptedPassword = await Bun.password.hash(body.password.toString());
  const jwtSecretKey = process.env.SECRET_KEY_JWT || '';
  const randomTokenEmail = jwt.sign({ email: body.email }, jwtSecretKey);

  const isTesting = process.env.ENVIRONMENT === 'testing';

  // Create user
  const user = new User();
  user.username = body.username;
  user.email = body.email.toLowerCase();
  user.password = encryptedPassword;
  user.isVerified = isTesting;
  user.isActive = true;

  const savedUser = await userRepository.save(user);

  // Create user roles
  const userRole = new UserRole();
  userRole.userId = savedUser.id;
  userRole.roleId = 3; // Normal user
  await userRoleRepository.save(userRole);

  if (!isTesting) {
    await sendConfirmationEmail(body.username, body.email.toLowerCase(), randomTokenEmail);
  }

  return respond.with201().body({
    message: `User '${body.username}' has been successfully created.`,
    user: {} as any, // User data is returned in a simplified format for security
  });
};

export const loginGoogle: LoginGoogle = async ({ body }, respond, _req, res) => {
  const userInfo = await verifyCodeOAuth(body.code);

  let user = await userRepository.findOne({
    where: { email: userInfo.email },
    relations: {
      userAuths: true,
      userRoles: true,
    },
  });

  // Filter for Google auth
  const googleAuth = user?.userAuths.find((ua) => ua.provider === 'google' && ua.providerUserId === userInfo.sub);

  if (user && (!user.userAuths || user.userAuths.length === 0 || !googleAuth)) {
    throw new AccountConflictError(
      'This email is already registered with a different authentication method. Please log in using your email and password.',
    );
  }

  if (!user) {
    // Create user
    user = new User();
    user.username = userInfo.name;
    user.email = userInfo.email;
    user.isVerified = true;
    user.isActive = true;
    const savedUser = await userRepository.save(user);

    // Create user role
    const userRole = new UserRole();
    userRole.userId = savedUser.id;
    userRole.roleId = 3; // Normal user
    await userRoleRepository.save(userRole);

    // Create user auth
    const userAuth = new UserAuth();
    userAuth.userId = savedUser.id;
    userAuth.provider = 'google';
    userAuth.providerUserId = userInfo.sub;
    await userAuthRepository.save(userAuth);

    // Reload user with relations
    user = await userRepository.findOne({
      where: { id: savedUser.id },
      relations: {
        userAuths: true,
        userRoles: true,
      },
    });
  }

  if (!user) {
    throw new InvalidCredentialsError('Failed to authenticate Google user.');
  }

  const user_role = await userRoleRepository.find({
    where: { user: { id: user.id } },
    relations: {
      role: true,
    },
  });

  const list_roles = user_role.map((ur) => ur.roleId);
  const token = createToken(user.id, list_roles);

  res.cookie('access_token', token, {
    expires: new Date(Date.now() + maxAgeJWT * 1000),
    httpOnly: true,
    secure: true,
    sameSite: 'none',
  });

  return respond.with200().body({
    message: `Successful login, ${user.username}`,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      roles: user.userRoles?.map((ur) => ({ id_role: ur.roleId })) || [],
    },
    token: token,
  });
};

export const getDiscordAuthUrl: GetDiscordAuthUrl = async (_params, respond) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = encodeURIComponent(process.env.DISCORD_REDIRECT_URI || '');
  const scope = encodeURIComponent('identify email');
  const responseType = 'code';

  const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=${responseType}&scope=${scope}`;

  return respond.with200().body({ url: discordAuthUrl });
};

export const loginDiscord: LoginDiscord = async ({ body }, respond, _req, res) => {
  let tokenResponse;
  try {
    tokenResponse = await clientDiscord.tokenRequest({
      code: body.code,
      scope: 'identify email',
      grantType: 'authorization_code',
    });
  } catch (error: any) {
    // DiscordHTTPError is thrown when the OAuth code is invalid, expired, or already used
    if (error.message?.includes('Bad Request') || error.statusCode === 400) {
      throw new AuthCredentialsExpiredError(
        'The Discord authorization code is invalid or has expired. Please try again.',
      );
    }
    throw new InvalidCredentialsError('Failed to authenticate with Discord. Please try again.');
  }

  let discordUser;
  try {
    discordUser = await clientDiscord.getUser(tokenResponse.access_token);
  } catch (error) {
    logger.error(`Failed to retrieve Discord user: ${error instanceof Error ? error.message : String(error)}`);
    throw new InvalidCredentialsError('Failed to retrieve Discord user information. Please try again.');
  }

  let user = await userRepository.findOne({
    where: { email: discordUser.email ?? '' },
    relations: {
      userAuths: true,
      userRoles: true,
    },
  });

  // Filter for Discord auth
  const discordAuth = user?.userAuths.find((ua) => ua.provider === 'discord' && ua.providerUserId === discordUser.id);

  if (user && (!user.userAuths || user.userAuths.length === 0 || !discordAuth)) {
    throw new AccountConflictError(
      'This email is already registered with a different authentication method. Please log in using your email and password.',
    );
  }

  if (!user) {
    // Create user
    user = new User();
    user.username = discordUser.username;
    user.email = discordUser.email ?? '';
    user.isVerified = true;
    user.isActive = true;
    const savedUser = await userRepository.save(user);

    // Create user role
    const userRole = new UserRole();
    userRole.userId = savedUser.id;
    userRole.roleId = 3; // Normal user
    await userRoleRepository.save(userRole);

    // Create user auth
    const userAuth = new UserAuth();
    userAuth.userId = savedUser.id;
    userAuth.provider = 'discord';
    userAuth.providerUserId = discordUser.id;
    await userAuthRepository.save(userAuth);

    // Reload user with relations
    user = await userRepository.findOne({
      where: { id: savedUser.id },
      relations: {
        userAuths: true,
        userRoles: true,
      },
    });
  }

  if (!user) {
    throw new InvalidCredentialsError('Failed to authenticate Discord user.');
  }

  const user_role = await userRoleRepository.find({
    where: { user: { id: user.id } },
    relations: {
      role: true,
    },
  });

  const list_roles = user_role.map((ur) => ur.roleId);
  const token = createToken(user.id, list_roles);

  res.cookie('access_token', token, {
    expires: new Date(Date.now() + maxAgeJWT * 1000),
    httpOnly: true,
    secure: true,
    sameSite: 'none',
  });

  return respond.with200().body({
    message: `Successful login, ${user.username}`,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      roles: user.userRoles?.map((ur) => ({ id_role: ur.roleId })) || [],
    },
    token: token,
  });
};

const client = new OAuth2Client({
  clientId: process.env.ID_OAUTH_GOOGLE,
  clientSecret: process.env.SECRET_OAUTH_GOOGLE,
  redirectUri: process.env.URI_ALLOWED_GOOGLE,
});

const clientDiscord = new DiscordOauth2({
  clientId: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  redirectUri: process.env.DISCORD_REDIRECT_URI,
});

interface GoogleUserInfo {
  sub: string;
  name: string;
  email: string;
}

async function verifyCodeOAuth(code: string): Promise<GoogleUserInfo> {
  try {
    const { tokens } = await client.getToken(code);
    client.setCredentials({ access_token: tokens.access_token });
    const userinfo = await client.request({
      url: 'https://www.googleapis.com/oauth2/v3/userinfo',
    });
    return userinfo.data as GoogleUserInfo;
  } catch (error: any) {
    // Handle invalid or expired Google OAuth codes
    if (error?.message?.includes('invalid_grant') || error?.code === 400) {
      throw new AuthCredentialsExpiredError(
        'The Google authorization code is invalid or has expired. Please try again.',
      );
    }
    throw new InvalidCredentialsError('Failed to authenticate with Google. Please try again.');
  }
}
