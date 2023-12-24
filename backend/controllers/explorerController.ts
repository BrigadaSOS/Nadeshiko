import { StatusCodes } from "http-status-codes";
import connection from "../database/db_posgres";
import { Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";

 

export const getFilesFromDirectory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // TEMPORAL 
    let MEDIA_DIRECTORY = null 

    if (process.env.ENVIRONMENT === "testing") {
      MEDIA_DIRECTORY = path.resolve(__dirname, '../media');
    }else if(process.env.ENVIRONMENT === 'production'){
      MEDIA_DIRECTORY = path.resolve(__dirname, 'mnt/nadedb/media');
    }
    
    let directory = typeof req.query.directory === 'string' ? req.query.directory : 'media';
    const order = req.query.order;
    const sortBy = req.query.sortBy;

    if (!directory) {
      return res.status(400).json({ error: "Directorio no especificado" });
    }

    directory = path.normalize(directory).replace(/^(\.\.[\/\\])+/, '');

    if (directory.startsWith('media') || directory.startsWith('media/')) {
      directory = directory.replace(/^media[\/\\]?/, '');
    }    

    // Construir la ruta solicitada
    const requestedPath = path.join(MEDIA_DIRECTORY, directory);

    console.log('Final Requested Path:', requestedPath); // Para depuración

    if (!requestedPath.startsWith(MEDIA_DIRECTORY)) {
      return res.status(403).json({ error: 'Acceso a directorio no permitido' });
    }

    fs.readdir(requestedPath, { withFileTypes: true }, async (err, files) => {
      if (err) {
        res.status(500).send("Error al leer el directorio");
        return;
      }

      let fileList = await Promise.all(files.map(async (dirent) => {
        const filePath = path.join(requestedPath, dirent.name);
        try {
          const stats = await fs.promises.stat(filePath);
          return {
            name: dirent.name,
            type: dirent.isFile() ? 'file' : 'directory',
            size: stats.size,
            createdDate: stats.birthtime.toISOString(),
            lastModified: stats.mtime.toISOString(),
          };
        } catch (error) {
          console.error(`Error al obtener estadísticas para ${filePath}:`, error);
          return null;
        }
      }));

      fileList = fileList.filter(item => item !== null);

      res.status(StatusCodes.OK).json(fileList);
    });
  } catch (error) {
    next(error);
  }
};


