import { StatusCodes } from "http-status-codes";
import connection from "../database/db_posgres";
import { Request, Response, NextFunction } from "express";
import { addBasicData, readAnimeDirectories, readSpecificDirectory } from "../database/db_initial";
import { Authorized, BadRequest, Conflict, NotFound } from "../utils/error";

const mediaDirectory: string = process.env.MEDIA_DIRECTORY!;

export const reSyncDatabase = async (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    await connection.sync({ force: true }).then(async () => {
      const db = connection.models;
      await addBasicData(db);
      await readAnimeDirectories(mediaDirectory);
    });
    res.status(StatusCodes.OK).json({ message: "Database re-synced" });
  } catch (error) {
    next(error);
  }
};

export const SyncSpecificAnime = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { folder_name, season, episode, force } = req.body;
    await readSpecificDirectory(mediaDirectory, folder_name);
    res.status(StatusCodes.OK).json({ message: "Anime synced" });
  }catch (error) {
    next(error);
  }
};
