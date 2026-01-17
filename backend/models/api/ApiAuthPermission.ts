import { Table, Model, Column, DataType, ForeignKey } from 'sequelize-typescript';
import { ApiAuth } from './apiAuth';
import { ApiPermission } from './apiPermission';

@Table({
  timestamps: false,
  tableName: 'ApiAuthPermission',
})
export class ApiAuthPermission extends Model {
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    primaryKey: true,
    autoIncrement: true,
  })
  declare id: number;

  @ForeignKey(() => ApiAuth)
  @Column
  apiAuthId!: number;

  @ForeignKey(() => ApiPermission)
  @Column
  apiPermissionId!: number;
}
