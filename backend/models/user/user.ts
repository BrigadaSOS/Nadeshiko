import { Table, Model, Column, DataType } from 'sequelize-typescript';
import { DataTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import type { ApiAuth } from '../api/apiAuth';
import type { ApiUsageHistory } from '../api/apiUsageHistory';
import type { UserRole } from './userRole';
import type { UserAuth } from './userAuth';

@Table({
  timestamps: false,
  tableName: 'User',
})
export class User extends Model {
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    primaryKey: true,
    autoIncrement: true,
  })
  declare id: number;

  // Basic data from user
  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  username!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  email!: string;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  })
  created_at!: Date;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  modified_at!: Date;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  last_login!: Date;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  is_verified!: boolean;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  is_active!: boolean;

  // Fields for local auth
  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  password!: string;

  declare apiAuth?: ApiAuth;
  declare apiUsageHistories?: ApiUsageHistory[];
  declare userRoles?: UserRole[];
  declare userAuths?: UserAuth[];

  static associate(sequelize: Sequelize) {
    const ApiAuth = sequelize.models.ApiAuth;
    const ApiUsageHistory = sequelize.models.ApiUsageHistory;
    const UserRole = sequelize.models.UserRole;
    const UserAuth = sequelize.models.UserAuth;

    User.hasOne(ApiAuth, { foreignKey: 'userId', as: 'apiAuth' });
    User.hasMany(ApiUsageHistory, { foreignKey: 'user_id', as: 'apiUsageHistories' });
    User.hasMany(UserRole, { foreignKey: 'id_user', as: 'userRoles' });
    User.hasMany(UserAuth, { foreignKey: 'userId', as: 'userAuths' });
  }
}
