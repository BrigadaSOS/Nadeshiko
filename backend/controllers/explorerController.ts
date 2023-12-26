import { StatusCodes } from "http-status-codes";
import connection from "../database/db_posgres";
import { Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";
import multer from 'multer';


export const getFilesFromDirectory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // TEMPORAL 
    let MEDIA_DIRECTORY = '' 

    if (process.env.ENVIRONMENT === "testing") {
      MEDIA_DIRECTORY = path.resolve(__dirname, '../media');
    }else if(process.env.ENVIRONMENT === 'production'){
      MEDIA_DIRECTORY = path.resolve(__dirname, '/data/media');
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


export const createFolder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    let MEDIA_DIRECTORY = '';

    if (process.env.ENVIRONMENT === 'testing') {
      MEDIA_DIRECTORY = path.resolve(__dirname, '../media');
    } else if (process.env.ENVIRONMENT === 'production') {
      MEDIA_DIRECTORY = path.resolve(__dirname, '/data/media');
    }

    let directory = typeof req.body.directory === 'string' ? req.body.directory : 'media';

    if (!directory) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: 'Directorio no especificado' });
    }

    directory = path.normalize(directory).replace(/^(\.\.[/\\])+/g, '');

    if (directory.startsWith('media') || directory.startsWith('media/')) {
      directory = directory.replace(/^media[/\\]?/g, '');
    }

    // Construct the full path for the new folder
    const newFolderPath = path.join(MEDIA_DIRECTORY, directory, req.body.folderName);

    // Check if the folder already exists
    if (fs.existsSync(newFolderPath)) {
      return res.status(StatusCodes.CONFLICT).json({ error: 'La carpeta ya existe' });
    }

    // Create the new folder
    fs.mkdir(newFolderPath, { recursive: true }, (err) => {
      if (err) {
        console.error('Error al crear la carpeta:', err);
        return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Error al crear la carpeta' });
      }

      res.status(StatusCodes.CREATED).json({ message: 'Carpeta creada exitosamente' });
    });
  } catch (error) {
    next(error);
  }
};

export const deleteFolderOrFile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    let MEDIA_DIRECTORY = '';

    if (process.env.ENVIRONMENT === 'testing') {
      MEDIA_DIRECTORY = path.resolve(__dirname, '../media');
    } else if (process.env.ENVIRONMENT === 'production') {
      MEDIA_DIRECTORY = path.resolve(__dirname, '/data/media');
    }

    let directory = typeof req.body.directory === 'string' ? req.body.directory : '';

    if (!directory) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: 'Ruta del elemento no especificada' });
    }

    directory = path.normalize(directory).replace(/^(\.\.[/\\])+/g, '');

    if (directory.startsWith('media') || directory.startsWith('media/')) {
      directory = directory.replace(/^media[/\\]?/g, '');
    }

    const fullPath = path.join(MEDIA_DIRECTORY, directory);

    if (!fs.existsSync(fullPath)) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: 'Elemento no encontrado' });
    }

    const stats = fs.statSync(fullPath);

    if (stats.isFile()) {
      fs.unlinkSync(fullPath);
    } else if (stats.isDirectory()) {
      fs.rmdirSync(fullPath, { recursive: true });
    }

    res.status(StatusCodes.OK).json({ message: 'Elemento eliminado exitosamente' });
  } catch (error) {
    next(error);
  }
};


export const dynamicStorage = async(req: Request, res: Response, next: NextFunction) => {
  const storage = multer.diskStorage({
    destination: function(req: Request, _file: any, cb: any) {
      let MEDIA_DIRECTORY = '';
    
      if (process.env.ENVIRONMENT === 'testing') {
        MEDIA_DIRECTORY = path.resolve(__dirname, '../media');
      } else if (process.env.ENVIRONMENT === 'production') {
        MEDIA_DIRECTORY = path.resolve(__dirname, '/data/media');
      }
    
      let directory = typeof req.body.directory === 'string' ? req.body.directory : 'media';
    
      if (!directory) {
        return res.status(StatusCodes.BAD_REQUEST).json({ error: 'Directorio no especificado' });
      }
    
      directory = path.normalize(directory).replace(/^(\.\.[/\\])+/g, '');
    
      if (directory.startsWith('media') || directory.startsWith('media/')) {
        directory = directory.replace(/^media[/\\]?/g, '');
      }
      const uploadPath = path.join(MEDIA_DIRECTORY, directory);
      cb(null, uploadPath);
    },
    filename: function(_req: Request, file: any, cb: any) {
      cb(null, file.originalname); 
    }
  });

  const upload = multer({ storage: storage }).fields([
    { name: 'file', maxCount: 1 }
  ]);

  upload(req, res, function (err: { message: any; }) {
    if (err instanceof multer.MulterError) {
      return res.status(500).json({ error: err.message });
    } else if (err) {
      return res.status(500).json({ error: 'Error desconocido al subir archivo' });
    }
    next();
  });

};

export const uploadFile = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ message: "Archivo subido con éxito" });
  } catch (error) {
    next(error);
  }
};