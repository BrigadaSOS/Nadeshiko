var jwt = require('jsonwebtoken');
export const maxAge: number = 3 * 24 * 60 * 60 // 3 days

export const createToken = (id: number, role: any[]): string => {
  const jwtSecretKey: string = process.env.SECRET_KEY_JWT as string || ''
  return jwt.sign({ user_id: id, roles: role }, jwtSecretKey, { algorithm: 'HS256', expiresIn: maxAge })
}