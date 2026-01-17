import { Table, Model, Column, DataType } from 'sequelize-typescript';
import type { Sequelize } from 'sequelize-typescript';
import type { ApiAuth } from './apiAuth';

@Table({
  timestamps: false,
  tableName: 'ApiPermission',
})
export class ApiPermission extends Model {
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    primaryKey: true,
    autoIncrement: true,
  })
  declare id: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  name!: string;

  declare apiAuths?: ApiAuth[];

  static associate(sequelize: Sequelize) {
    const ApiAuth = sequelize.models.ApiAuth;
    const ApiAuthPermission = sequelize.models.ApiAuthPermission;

    ApiPermission.belongsToMany(ApiAuth, {
      through: ApiAuthPermission,
      foreignKey: 'apiPermissionId',
      otherKey: 'apiAuthId',
      as: 'apiAuths',
    });
  }
}
