import { Authorized, BadRequest } from '../utils/error'
import { Response, NextFunction } from 'express'
var jwt = require('jsonwebtoken');

// Check the user if is Authenticated
export const isAuthJWT = (req: any, _: Response, next: NextFunction): void => {
  const authHeader: string | undefined = req.headers['cookie']
  const token = authHeader ? authHeader && authHeader.split('=')[1] : ''

  if (!token) {
    throw new Authorized('No hay token...')
  }

  try {
    const jwtSecretKey: string = process.env.SECRET_KEY_JWT ? process.env.SECRET_KEY_JWT : ''
    const decoded = jwt.verify(token, jwtSecretKey)
    req.jwt = decoded
    const roles = (<any>decoded).roles

    // Role validation
    if (roles.includes(1)) {
      return next()
    } else {
      throw new Authorized('Acceso denegado. No autorizado...')
    }
  } catch (error) {
    console.log(error)
    //next(error)
    if (error.message === 'jwt expired') {
      //res.clearCookie('access_token')
      throw new BadRequest('El token JWT ha expirado.')
    } else {
      //res.clearCookie('access_token')
      throw new Authorized('Token invalido...')
    }
  }
}