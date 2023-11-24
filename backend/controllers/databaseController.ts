import { StatusCodes } from "http-status-codes";
import connection from "../database/db_posgres";
import { Request, Response, NextFunction } from "express";
import { addBasicData, readAnimeDirectories, readSpecificDirectory } from "../database/db_initial";
import { UserSearchHistory } from "../models/miscellaneous/userSearchHistory";

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

export const reSyncDatabasePartial = async (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    await connection.sync({ alter: true })
    res.status(StatusCodes.OK).json({ message: "Database re-synced without deleting everything" });
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
    let message = await readSpecificDirectory(mediaDirectory, folder_name, season, episode, force);
    res.status(StatusCodes.OK).json({ message: message });
  }catch (error) {
    next(error);
  }
};

export const SaveUserSearchHistory = async (
  EventType: number,
  Query: any,
  IP: any
) => {
  try {
    const searchLog = await UserSearchHistory.create({
      event_type: EventType,
      query: Query,
      ip_address: IP
    })

    await searchLog.save();
    console.log( "Search log inserted into the database");

  }catch (error) {
    console.log( "Error while inserting search log into the database", error);
  }
};