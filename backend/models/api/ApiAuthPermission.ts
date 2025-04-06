import {
  Table,
  Model,
  Column,
  DataType,
  HasMany,
  BelongsTo,
  BelongsToMany,
  ForeignKey,
  HasOne,
} from 'sequelize-typescript';
import { ApiPermission } from './apiPermission';
import { User } from '../user/user';
import { ApiUsageHistory } from './apiUsageHistory';
import { ApiAuth } from './apiAuth';

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
  id!: number;

  @ForeignKey(() => ApiAuth)
  @Column
  apiAuthId!: number;

  @ForeignKey(() => ApiPermission)
  @Column
  apiPermissionId!: number;
}
