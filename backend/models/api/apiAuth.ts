import { Table, Model, Column, DataType, ForeignKey } from 'sequelize-typescript';
import type { Sequelize } from 'sequelize-typescript';
import type { ApiPermission } from './apiPermission';
import { User } from '../user/user';

@Table({
  timestamps: false,
  tableName: 'ApiAuth',
})
export class ApiAuth extends Model {
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    primaryKey: true,
    autoIncrement: true,
  })
  declare id: number;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  name!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  hint!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  token!: string;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare createdAt: Date;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
  })
  isActive!: boolean;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  userId!: number;

  declare permissions?: ApiPermission[];
  declare user?: User;

  static associate(sequelize: Sequelize) {
    const ApiPermissionModel = sequelize.models.ApiPermission;
    const ApiAuthPermissionModel = sequelize.models.ApiAuthPermission;
    const UserModel = sequelize.models.User;

    ApiAuth.belongsToMany(ApiPermissionModel, {
      through: ApiAuthPermissionModel,
      foreignKey: 'apiAuthId',
      otherKey: 'apiPermissionId',
      as: 'permissions',
    });
    ApiAuth.belongsTo(UserModel, { foreignKey: 'userId', as: 'user' });
  }
}
