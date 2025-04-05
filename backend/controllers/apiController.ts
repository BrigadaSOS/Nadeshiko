import { Authorized, BadRequest, Conflict, NotFound } from "../utils/error";
import { Request, Response, NextFunction } from "express";
import { StatusCodes } from "http-status-codes";
import { User } from "../models/user/user";
import { ApiAuth } from "../models/api/apiAuth";
import { generateApiKey, generateApiKeyHint, hashApiKey } from "../utils/utils";
import { ApiPermission } from "../models/api/apiPermission";
import { ApiAuthPermission } from "../models/api/ApiAuthPermission";
import { ApiUsageHistory } from "../models/api/apiUsageHistory";
import { Role } from "../models/user/role";
import { UserRole } from "../models/user/userRole";
import { Op } from "sequelize";

export const createAPIKeyDefault = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { user_id } = req.jwt;
    const { name } = req.body;

    const user = await User.findOne({
      where: { id: user_id },
    });

    if (!name) throw new NotFound("Name for API key not found.");
    if (!user) throw new NotFound("User not found.");

    // Create a default API Key
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

    // Set default permissions for API Key
    const permissions = ["READ_MEDIA"];
    const apiPermissions = await ApiPermission.findAll({
      where: {
        name: permissions,
      },
    });

    await Promise.all(
      apiPermissions.map(async (permission) => {
        await ApiAuthPermission.create({
          apiAuthId: api_auth_object.id,
          apiPermissionId: permission.id,
        });
      })
    );

    // Return final response
    res
      .status(StatusCodes.CREATED)
      .json({ message: "API Key created successfully", key: api_key });
  } catch (error) {
    next(error);
  }
};

export const deactivateAPIKey = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { user_id } = req.jwt;
  const { api_key_id } = req.body;

  if (!api_key_id) {
    return next(new BadRequest("ID of the API Key must be provided."));
  }

  try {
    const apiKey = await ApiAuth.findOne({
      where: { id: api_key_id },
    });

    if (!apiKey) {
      throw new NotFound("API Key not found.");
    }

    if(apiKey.userId != user_id) {
      throw new NotFound("API Key not found.");
    }

    if (!apiKey.isActive) {
      return res.status(StatusCodes.OK).json({
        message: "API Key is already inactive.",
      });
    }

    apiKey.isActive = false;
    await apiKey.save();

    res.status(StatusCodes.OK).json({
      message: "API Key has been deactivated.",
    });
  } catch (error) {
    next(error);
  }
};

export const listAPIKeysByUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { user_id } = req.jwt;

  try {
    // Fetching API keys owned by the user
    const apiKeys = await ApiAuth.findAll({
      where: { userId: user_id },
      attributes: ["id", "name", "isActive", "createdAt", "hint"],
      include: [
        {
          model: ApiPermission,
          attributes: ["id", "name"],
          through: {
            attributes: [],
          },
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    // Calculate the start of the month for usage calculations
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Aggregate total usage across all API keys for the user for the current month
    const totalQuotaUsed = await ApiUsageHistory.count({
      where: {
        apiAuthId: apiKeys.length ? apiKeys.map((key) => key.id) : [0], // Use [0] to ensure SQL doesn't fail if there are no keys
        used_at: { [Op.gte]: startOfMonth },
      },
    });

    // Find the highest quota limit across all roles associated with the user
    const userRoles = await UserRole.findAll({
      include: [
        {
          model: User,
          attributes: [],
          where: { id: user_id },
        },
        {
          model: Role,
          attributes: ["quotaLimit"],
        },
      ],
    });

    const hasUnlimitedQuota = userRoles.some(
      (role) => role.role.quotaLimit === -1
    );
    const highestQuotaLimit = hasUnlimitedQuota
      ? -1
      : Math.max(...userRoles.map((role) => role.role.quotaLimit));

    const keys = apiKeys.map((apiKey) => ({
      id: apiKey.id,
      name: apiKey.name,
      isActive: apiKey.isActive,
      createdAt: apiKey.createdAt,
      hint: apiKey.hint,
      permissions: apiKey.permissions.sort((a, b) => a.id - b.id)
        .map((permission) => ({
          id: permission.id,
          name: permission.name,
        })),
    }));

    res.status(StatusCodes.OK).json({
      keys: keys,
      quota: {
        quotaUsed: totalQuotaUsed,
        quotaLimit: highestQuotaLimit === -1 ? "NO_LIMIT" : highestQuotaLimit,
      },
    });
  } catch (error) {
    console.error("Error listing API keys:", error);
    next(error);
  }
};
