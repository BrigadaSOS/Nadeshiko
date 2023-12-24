import { NextFunction, Request, Response } from "express";
import { GeneralError, NotFound } from "../utils/error";
// HTTP Codes
import { StatusCodes } from "http-status-codes";

export const handleErrors = (
  error: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (error instanceof GeneralError) {
    return res.status(error.getCode()).json({
      status: res.statusCode,
      error: error,
    });
  }

  // Verificar si el error es un archivo no encontrado (404)
  if (error.message.includes("ENOENT")) {
    const filePath = (error as NodeJS.ErrnoException).path;
    const notFoundError = new NotFound(`File not found: ${filePath}`);
    return res.status(notFoundError.getCode()).json({
      status: res.statusCode,
      error: notFoundError,
    });
  }

  return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
    status: res.statusCode,
    error: error,
  });
};
