import { Op } from 'sequelize';
import { User } from '../models/user/user';
import { UserRole } from '../models/user/userRole';
import { Role, DEFAULT_QUOTA_LIMIT } from '../models/user/role';
import { ApiAuth } from '../models/api/apiAuth';
import { ApiPermission } from '../models/api/apiPermission';
import { ApiAuthPermission } from '../models/api/ApiAuthPermission';
import { ApiUsageHistory } from '../models/api/apiUsageHistory';
import { generateApiKey, generateApiKeyHint, hashApiKey } from '../utils/utils';
import {
  UserNotFoundError,
  InsufficientPermissionsError,
  NotFoundError,
  InvalidRequestError,
} from '../utils/apiErrors';
import type { GetUserInfo, GetIdentityMe, CreateApiKey, GetApiKeys, DeactivateApiKey } from 'generated/routes/user';

export const getUserInfo: GetUserInfo = async (_params, respond, req) => {
  const user = await User.findOne({
    where: { id: req.jwt.user_id },
    include: [
      {
        model: UserRole,
        as: 'userRoles',
        required: false,
        include: [{ model: Role, as: 'role', required: true }],
      },
    ],
  });

  if (!user) {
    throw new UserNotFoundError();
  }

  return respond.with200().body({
    user: {
      username: user.username,
      email: user.email,
      roles:
        user.userRoles?.map((userRole: UserRole) => ({
          id_role: userRole.id_role,
          name: userRole.role?.name,
        })) || [],
    },
  });
};

export const getIdentityMe: GetIdentityMe = async (_params, respond, req) => {
  const user = await User.findOne({
    where: { id: req.jwt.user_id },
    include: [
      {
        model: UserRole,
        as: 'userRoles',
        required: false,
        include: [{ model: Role, as: 'role', required: true }],
      },
    ],
  });

  if (!user) {
    throw new UserNotFoundError();
  }

  return respond.with200().body({
    user: {
      username: user.username,
      email: user.email,
      roles:
        user.userRoles?.map((userRole: UserRole) => ({
          id_role: userRole.id_role,
          name: userRole.role?.name,
        })) || [],
    },
  });
};

export const createApiKey: CreateApiKey = async ({ body }, respond, req) => {
  const { user_id, roles } = req.jwt;
  const { name, permissions: requestedPermissions } = body;

  const user = await User.findOne({ where: { id: user_id } });
  if (!user) {
    throw new UserNotFoundError();
  }

  let permissions: string[];
  if (!requestedPermissions || requestedPermissions.length === 0) {
    permissions = ['READ_MEDIA'];
  } else {
    const hasNonReadPermission = requestedPermissions.some((p: string) => p !== 'READ_MEDIA');
    if (hasNonReadPermission) {
      if (!roles.includes(1)) {
        throw new InsufficientPermissionsError('Admin role required to perform this action');
      }
    }
    permissions = requestedPermissions;

    const validPermissions = await ApiPermission.findAll({ attributes: ['name'] });
    const validPermissionNames = validPermissions.map((p) => p.name);
    const invalidPermissions = permissions.filter((p: string) => !validPermissionNames.includes(p));

    if (invalidPermissions.length > 0) {
      throw new InvalidRequestError(`Invalid permissions: ${invalidPermissions.join(', ')}`);
    }
  }

  const api_key = generateApiKey();
  const api_key_hashed = hashApiKey(api_key);
  const api_key_hint = generateApiKeyHint(api_key);

  const api_auth_object = await ApiAuth.create({
    name: name,
    token: api_key_hashed,
    hint: api_key_hint,
    isActive: true,
    createdAt: new Date().toISOString(),
    userId: user_id,
  });

  const apiPermissions = await ApiPermission.findAll({ where: { name: permissions } });

  await Promise.all(
    apiPermissions.map(async (permission) => {
      await ApiAuthPermission.create({
        apiAuthId: api_auth_object.id,
        apiPermissionId: permission.id,
      });
    }),
  );

  return respond.with201().body({ message: 'API Key created successfully', key: api_key });
};

export const getApiKeys: GetApiKeys = async (_params, respond, req) => {
  const { user_id } = req.jwt;

  const apiKeys = await ApiAuth.findAll({
    where: { userId: user_id },
    attributes: ['id', 'name', 'isActive', 'createdAt', 'hint'],
    include: [
      {
        model: ApiPermission,
        as: 'permissions',
        attributes: ['id', 'name'],
        through: { attributes: [] },
      },
    ],
    order: [['createdAt', 'DESC']],
  });

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const totalQuotaUsed = await ApiUsageHistory.count({
    where: {
      apiAuthId: apiKeys.length ? apiKeys.map((key) => key.id) : [0],
      used_at: { [Op.gte]: startOfMonth },
    },
  });

  const userRoles = await UserRole.findAll({
    include: [
      { model: User, as: 'user', attributes: [], where: { id: user_id } },
      { model: Role, as: 'role', attributes: ['quotaLimit'] },
    ],
  });

  const hasUnlimitedQuota = userRoles.some((role) => role.role?.quotaLimit === -1);
  const highestQuotaLimit = hasUnlimitedQuota
    ? -1
    : Math.max(...userRoles.map((role) => role.role?.quotaLimit ?? DEFAULT_QUOTA_LIMIT));

  const keys = apiKeys.map((apiKey) => ({
    id: apiKey.id,
    name: apiKey.name,
    isActive: apiKey.isActive,
    createdAt: apiKey.createdAt.toISOString(),
    hint: apiKey.hint,
    permissions: (apiKey.permissions ?? [])
      .sort((a, b) => a.id - b.id)
      .map((permission) => ({ id: permission.id, name: permission.name })),
  }));

  return respond.with200().body({
    keys: keys,
    quota: {
      quotaUsed: totalQuotaUsed,
      quotaLimit: highestQuotaLimit === -1 ? 'NO_LIMIT' : highestQuotaLimit,
    },
  });
};

export const deactivateApiKey: DeactivateApiKey = async ({ body }, respond, req) => {
  const { user_id } = req.jwt;
  const { api_key_id } = body;

  const apiKey = await ApiAuth.findOne({ where: { id: api_key_id } });

  if (!apiKey || apiKey.userId != user_id) {
    throw new NotFoundError();
  }

  if (!apiKey.isActive) {
    return respond.with200().body({ message: 'API Key is already inactive.' });
  }

  apiKey.isActive = false;
  await apiKey.save();

  return respond.with200().body({ message: 'API Key has been deactivated.' });
};
