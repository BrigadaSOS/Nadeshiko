import { User, UserRole, DEFAULT_QUOTA_LIMIT, ApiAuth, ApiPermission, ApiAuthPermission } from '@app/entities';
import { generateApiKey, generateApiKeyHint, hashApiKey } from '@lib/utils/utils';
import { InsufficientPermissionsError, NotFoundError, InvalidRequestError } from '@lib/utils/apiErrors';
import type { GetUserInfo, GetIdentityMe, CreateApiKey, GetApiKeys, DeactivateApiKey } from 'generated/routes/user';

export const getUserInfo: GetUserInfo = async (_params, respond, req) => {
  const user = await User.findOne({
    where: { id: req.jwt.user_id },
    relations: {
      userRoles: {
        role: true,
      },
    },
  });

  if (!user) {
    throw NotFoundError.forUser();
  }

  return respond.with200().body({
    user: {
      username: user.username,
      email: user.email,
      roles:
        user.userRoles?.map((userRole) => ({
          id_role: userRole.roleId,
          name: userRole.role?.name,
        })) || [],
    },
  });
};

export const getIdentityMe: GetIdentityMe = async (_params, respond, req) => {
  const user = await User.findOne({
    where: { id: req.jwt.user_id },
    relations: {
      userRoles: {
        role: true,
      },
    },
  });

  if (!user) {
    throw NotFoundError.forUser();
  }

  return respond.with200().body({
    user: {
      username: user.username,
      email: user.email,
      roles:
        user.userRoles?.map((userRole) => ({
          id_role: userRole.roleId,
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
    throw NotFoundError.forUser();
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

    // Validate permissions against the enum values
    const validPermissionNames = Object.values(ApiPermission);
    const invalidPermissions = permissions.filter((p: string) => !validPermissionNames.includes(p as ApiPermission));

    if (invalidPermissions.length > 0) {
      throw new InvalidRequestError(`Invalid permissions: ${invalidPermissions.join(', ')}`);
    }
  }

  const api_key = generateApiKey();
  const api_key_hashed = hashApiKey(api_key);
  const api_key_hint = generateApiKeyHint(api_key);

  const apiAuth = ApiAuth.create({
    name,
    token: api_key_hashed,
    hint: api_key_hint,
    isActive: true,
    userId: user_id,
  });

  await apiAuth.save();

  await Promise.all(
    permissions.map(async (permission) => {
      const authPermission = ApiAuthPermission.create({
        apiAuthId: apiAuth.id,
        apiPermission: permission as ApiPermission,
      });
      await authPermission.save();
    }),
  );

  return respond.with201().body({ message: 'API Key created successfully', key: api_key });
};

export const getApiKeys: GetApiKeys = async (_params, respond, req) => {
  const { user_id } = req.jwt;

  const apiKeys = await ApiAuth.find({
    where: { userId: user_id },
    relations: { permissions: true },
    order: { createdAt: 'DESC' },
  });

  const userRoles = await UserRole.find({
    relations: { role: true },
    where: { user: { id: user_id } },
  });

  const hasUnlimitedQuota = userRoles.some((role) => role.role?.quotaLimit === -1);
  const highestQuotaLimit = hasUnlimitedQuota
    ? -1
    : Math.max(...userRoles.map((role) => role.role?.quotaLimit ?? DEFAULT_QUOTA_LIMIT));

  const keys = apiKeys.map((apiKey) => ({
    id: apiKey.id,
    name: apiKey.name ?? '',
    isActive: apiKey.isActive,
    createdAt: apiKey.createdAt.toISOString(),
    hint: apiKey.hint ?? '',
    permissions: (apiKey.permissions ?? [])
      .sort((a, b) => a.id - b.id)
      .map((permission) => ({ id: permission.id, name: permission.apiPermission })),
  }));

  return respond.with200().body({
    keys: keys,
    quota: {
      quotaUsed: 0,
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
