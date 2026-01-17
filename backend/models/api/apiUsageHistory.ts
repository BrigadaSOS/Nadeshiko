import { Table, Model, Column, DataType, ForeignKey } from 'sequelize-typescript';
import type { Sequelize } from 'sequelize-typescript';
import { User } from '../user/user';
import { ApiAuth } from './apiAuth';

@Table({
  timestamps: false,
  tableName: 'ApiUsageHistory',
  indexes: [
    {
      fields: ['apiAuthId', 'used_at'],
    },
    {
      fields: ['user_id'],
    },
  ],
})
export class ApiUsageHistory extends Model {
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    primaryKey: true,
    autoIncrement: true,
  })
  declare id: number;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  used_at!: Date;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  user_id!: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  request!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  method!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  endpoint!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  ipAddress!: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  responseStatus!: number;

  declare user?: User;
  declare apiAuth?: ApiAuth;

  @ForeignKey(() => ApiAuth)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  apiAuthId!: number;

  static associate(sequelize: Sequelize) {
    const UserModel = sequelize.models.User;
    const ApiAuthModel = sequelize.models.ApiAuth;

    ApiUsageHistory.belongsTo(UserModel, { foreignKey: 'user_id', as: 'user' });
    ApiUsageHistory.belongsTo(ApiAuthModel, { foreignKey: 'apiAuthId', as: 'apiAuth' });
  }
}
