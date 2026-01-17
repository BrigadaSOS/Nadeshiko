import { Sequelize } from 'sequelize-typescript';
import { Segment } from '../models/media/segment';
import { Media } from '../models/media/media';
import { Role } from '../models/user/role';
import { UserRole } from '../models/user/userRole';
import { UserAuth } from '../models/user/userAuth';
import { UserToken } from '../models/user/userToken';
import { ApiAuthPermission } from '../models/api/ApiAuthPermission';
import { ApiPermission } from '../models/api/apiPermission';
import { ApiAuth } from '../models/api/apiAuth';
import { ApiUsageHistory } from '../models/api/apiUsageHistory';
import { User } from '../models/user/user';
import { UserSearchHistory } from '../models/miscellaneous/userSearchHistory';
import { Report } from '../models/miscellaneous/report';

import 'dotenv/config';

const connection = new Sequelize({
  dialect: 'postgres',
  /*
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
  },*/
  host: process.env.PG_HOST,
  username: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  port: Number(process.env.PG_PORT),
  models: [
    Media,
    Segment,
    ApiAuth,
    ApiPermission,
    ApiUsageHistory,
    ApiAuthPermission,
    User,
    UserRole,
    Role,
    UserSearchHistory,
    UserAuth,
    UserToken,
    Report,
  ],
  logging: false,
  pool: {
    max: 20,
    min: 5,
    acquire: 60000,
    idle: 5000,
  },
});

// Initialize associations after all models are registered
Object.values(connection.models).forEach((model) => {
  if ('associate' in model && typeof model.associate === 'function') {
    model.associate(connection);
  }
});

export default connection;
