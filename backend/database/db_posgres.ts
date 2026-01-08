import { Sequelize } from 'sequelize-typescript';
import { Media } from '../models/media/media';
import { Segment } from '../models/media/segment';
import { ApiAuth } from '../models/api/apiAuth';
import { ApiPermission } from '../models/api/apiPermission';
import { ApiUsageHistory } from '../models/api/apiUsageHistory';
import { ApiAuthPermission } from '../models/api/ApiAuthPermission';
import { User } from '../models/user/user';
import { UserRole } from '../models/user/userRole';
import { Role } from '../models/user/role';
import { UserSearchHistory } from '../models/miscellaneous/userSearchHistory';
import { UserAuth } from '../models/user/userAuth';
import { UserToken } from '../models/user/userToken';
import { Report } from '../models/miscellaneous/report';
import { EsSyncLog } from '../models/sync/esSyncLog';

require('dotenv').config();

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
    EsSyncLog,
  ],
  logging: false,
  pool: {
    max: 10,
    min: 0,
    acquire: 60000,
    idle: 5000,
  },
});

export default connection;
