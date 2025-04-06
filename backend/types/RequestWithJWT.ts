import { Request } from 'express';

export interface RequestWithJWT extends Request {
  jwt: {
    user_id: number;
  };
}
