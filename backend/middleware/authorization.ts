import { ApiAuth } from "../models/api/apiAuth";
import { User } from "../models/user/user";
import { Authorized, BadRequest } from "../utils/error";
import { Response, NextFunction, request } from "express";
import { parse } from "url";

import crypto from "crypto";
import { ApiPermission } from "../models/api/apiPermission";
import { ApiAuthPermission } from "../models/api/ApiAuthPermission";

function hashApiKey(apiKey: string) {
  const hashedKey = crypto.createHash("sha256").update(apiKey).digest("hex");
  return hashedKey;
}

export const isAuth = async (req: any, res: Response, next: NextFunction) => {
  const apiKey: string | undefined = req.headers["x-api-key"];
  const allowedUrls = process.env.ALLOWED_WEBSITE_URLS?.split(",");

  if (!allowedUrls) {
    return res
      .status(401)
      .json({ error: "No allowed URLs specified in the environment file." });
  }

  const requestUrl = parse(req.headers.referer || "");

  const requestFromAllowedUrl = allowedUrls.some((url) => {
    const parsedUrl = parse(url);
    return (
      parsedUrl.host === requestUrl.host &&
      parsedUrl.protocol === requestUrl.protocol
    );
  });

  if (!requestFromAllowedUrl && !apiKey) {
    return res.status(401).json({ error: "No API key was provided." });
  }

  // Verificar la clave de API solo si la solicitud no proviene de alguna página válida
  if (!requestFromAllowedUrl) {
    const hashedKey = hashApiKey(apiKey!);

    try {
      const user = await User.findOne({
        include: [
          {
            model: ApiAuth,
            where: { token: hashedKey },
            include: [
              {
                model: ApiPermission,
                through: ApiAuthPermission as any,
              },
            ],
          },
        ],
      });
      console.log(user)

      if (!user) {
        return res.status(401).json({ error: "Invalid API key." });
      } else {
        if (!req.user) {
          req.user = user;
        }
      }
    } catch (error) {
      console.log(error);
      throw new BadRequest("There was an error. Please try again later...");
    }
  }

  return next();
};
