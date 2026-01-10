import { StatusCodes } from 'http-status-codes';
import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import archiver from 'archiver';
import recursive from 'recursive-readdir';
import { logger } from '../utils/log';

export const getFilesFromDirectory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // TEMPORAL
    let MEDIA_DIRECTORY = '';

    if (process.env.ENVIRONMENT === 'testing') {
      MEDIA_DIRECTORY = path.resolve(__dirname, '../media');
    } else if (process.env.ENVIRONMENT === 'production') {
      MEDIA_DIRECTORY = path.resolve(__dirname, '/data/media');
    }

    let directory = typeof req.query.directory === 'string' ? req.query.directory : 'media';

    if (!directory) {
      return res.status(400).json({ error: 'Directorio no especificado' });
    }

    directory = path.normalize(directory).replace(/^(\.\.\/))+/, '');

    if (directory.startsWith('media') || directory.startsWith('media/')) {
      directory = directory.replace(/^media\/?/, '');
    }

    // Construir la ruta solicitada
    const requestedPath = path.join(MEDIA_DIRECTORY, directory);

    if (!requestedPath.startsWith(MEDIA_DIRECTORY)) {
      return res.status(403).json({ error: 'Acceso a directorio no permitido' });
    }

    fs.readdir(requestedPath, { withFileTypes: true }, async (err, files) => {
      if (err) {
        res.status(500).send('Error al leer el directorio');
        return;
      }

      let fileList = await Promise.all(
        files.map(async (dirent) => {
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
            logger.error({ err: error, filePath }, 'Error getting file statistics');
            return null;
          }
        }),
      );

      fileList = fileList.filter((item) => item !== null);

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
        logger.error({ err, newFolderPath }, 'Error creating folder');
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

export const dynamicStorage = async (req: Request, res: Response, next: NextFunction) => {
  const storage = multer.diskStorage({
    destination: function (req: Request, _file: any, cb: any) {
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
    filename: function (_req: Request, file: any, cb: any) {
      cb(null, file.originalname);
    },
  });

  const upload = multer({ storage: storage, limits: { fileSize: 10737418240 } }).fields([
    { name: 'file', maxCount: 1 },
  ]);

  upload(req, res, function (err) {
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
    res.status(200).json({ message: 'Archivo subido con éxito' });
  } catch (error) {
    next(error);
  }
};

export const downloadFile = async (req: Request, res: Response, _next: NextFunction) => {
  try {
    let MEDIA_DIRECTORY = '';

    if (process.env.ENVIRONMENT === 'testing') {
      MEDIA_DIRECTORY = path.resolve(__dirname, '../media');
    } else if (process.env.ENVIRONMENT === 'production') {
      MEDIA_DIRECTORY = path.resolve(__dirname, '/data/media');
    }

    let directory = typeof req.query.directory === 'string' ? req.query.directory : '';

    if (!directory) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: 'Ruta del elemento no especificada' });
    }

    directory = path.normalize(directory).replace(/^(\.\.[/\\])+/g, '');

    if (directory.startsWith('media') || directory.startsWith('media/')) {
      directory = directory.replace(/^media[/\\]?/g, '');
    }

    fullPath = path.join(MEDIA_DIRECTORY, directory);

    if (!fs.existsSync(fullPath)) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: 'Archivo o directorio no encontrado' });
    }

    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) {
      const zipFileName = `compressed-${Date.now()}.zip`;
      const outputZipPath = path.join(MEDIA_DIRECTORY, '/tmp', zipFileName);

      const output = fs.createWriteStream(outputZipPath);
      const archive = archiver('zip', {
        zlib: { level: 9 },
      });

      archive.pipe(output);

      archive.on('error', (err) => {
        logger.error({ err, fullPath }, 'Archive compression error');
        res.status(500).json({ error: 'Error al comprimir el directorio' });
      });

      archive.directory(fullPath, false);

      output.on('close', () => {
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);
        const fileStream = fs.createReadStream(outputZipPath);
        fileStream.pipe(res);
      });

      archive.finalize();
    } else {
      const fileSize = stats.size;

      let start, end;
      if (req.headers.range) {
        const parts = req.headers.range.replace(/bytes=/, '').split('-');
        start = parseInt(parts[0], 10);
        end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      } else {
        start = 0;
        end = fileSize - 1;
      }

      if (start >= fileSize) {
        res.status(416).send('Requested Range Not Satisfiable');
        return;
      }

      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(fullPath)}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', end - start + 1);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.status(206);

      const fileStream = fs.createReadStream(fullPath, { start, end });
      fileStream.on('error', (error) => {
        logger.error({ err: error, fullPath }, 'Error reading file stream');
        res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Error al leer el archivo' });
      });
      req.on('close', () => {
        fileStream.destroy();
      });
      fileStream.pipe(res);
    }
  } catch (error) {
    logger.error({ err: error }, 'Error downloading file');
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Error al descargar el archivo' });
  }
};

export const compressDirectory = async (req: Request, res: Response, _next: NextFunction) => {
  try {
    let MEDIA_DIRECTORY = '';

    if (process.env.ENVIRONMENT === 'testing') {
      MEDIA_DIRECTORY = path.resolve(__dirname, '../media');
    } else if (process.env.ENVIRONMENT === 'production') {
      MEDIA_DIRECTORY = path.resolve(__dirname, '/data/media');
    }

    let directory = typeof req.query.directory === 'string' ? req.query.directory : 'media';

    if (!directory) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: 'Ruta del elemento no especificada' });
    }

    directory = path.normalize(directory).replace(/^(\.\.[/\\])+/g, '');

    if (directory.startsWith('media') || directory.startsWith('media/')) {
      directory = directory.replace(/^media[/\\]?/g, '');
    }

    const outputZipPath = path.join(MEDIA_DIRECTORY, 'compressed.zip');
    pathToZip = path.join(MEDIA_DIRECTORY, directory);

    // Crear un archivo zip
    const output = fs.createWriteStream(outputZipPath);
    const archive = archiver('zip', {
      zlib: { level: 9 }, // Nivel de compresión
    });

    archive.on('error', (err) => {
      throw err;
    });

    archive.pipe(output);

    // Use recursive-readdir to get all files in the directory
    const files = await recursive(pathToZip);

    const totalSize = files.reduce((acc, file) => {
      const stat = fs.statSync(file);
      if (stat.isFile()) {
        return acc + stat.size;
      }
      return acc;
    }, 0);

    archive.directory(pathToZip, false);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    res.write('data: {"progress": 0}\n\n');

    archive.on('progress', (progress) => {
      const newProgress = (progress.fs.processedBytes / totalSize) * 100;
      res.write(`data: {"progress": ${newProgress.toFixed(2)}}\n\n`);
    });

    output.on('close', () => {
      logger.info({ totalBytes: archive.pointer() }, 'Directory compression completed');
      res.end();
    });
    archive.finalize();
  } catch (error) {
    logger.error({ err: error }, 'Error compressing directory');
    res.status(500).json({ error: 'Error al comprimir el directorio' });
  }
};
