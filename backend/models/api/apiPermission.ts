import { Table, Model, Column, DataType, HasMany, BelongsToMany } from 'sequelize-typescript';
import { ApiAuth } from './apiAuth';
import { ApiAuthPermission } from './ApiAuthPermission';

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
  id!: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  name!: string;

  @BelongsToMany(() => ApiAuth, () => ApiAuthPermission)
  apiAuths!: ApiAuth[];
}
