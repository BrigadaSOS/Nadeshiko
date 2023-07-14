import { ApiAuth } from "../models/api/apiAuth";
import { User } from "../models/user/user";
import { Authorized, BadRequest } from "../utils/error";
import { Response, NextFunction } from "express";

export const isAuth = async (req: any, res: Response, next: NextFunction) => {
  const apiKey: string | undefined = req.headers["x-api-key"];

  if (!apiKey) {
    return res.status(401).json({ error: "No API key was provided." });
  }

  try {
    const matchKey = await ApiAuth.findOne({
      where: { token: apiKey }
    });

    if (!matchKey) {
      return res.status(401).json({ error: "Invalid API key." });
    }

    return next();
  } catch (error) {
    throw new BadRequest(
      "There was an error. Please try a few minutes later..."
    );
  }
};
