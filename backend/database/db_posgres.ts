import { Sequelize } from "sequelize-typescript";
import { Category } from "../models/media/category";
import { Episode } from "../models/media/episode";
import { Media } from "../models/media/media";
import { Season } from "../models/media/season";
import { Segment } from "../models/media/segment";
import { ApiAuth } from "../models/api/apiAuth";
import { ApiPermission } from "../models/api/apiPermission";
import { ApiUsageHistory } from "../models/api/apiUsageHistory";
import { ApiAuthPermission } from "../models/api/ApiAuthPermission";
import { User } from "../models/user/user";

require("dotenv").config();

const connection = new Sequelize({
  dialect: "postgres",
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
    Category,
    Season,
    Episode,
    Segment,
    ApiAuth,
    ApiPermission,
    ApiUsageHistory,
    ApiAuthPermission,
    User,
  ],
  logging: true,
  pool: {
    max: 5,
    min: 0,
    acquire: 60000,
    idle: 5000,
  },
});

export default connection;
