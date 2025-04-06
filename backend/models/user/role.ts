import { Table, Model, Column, DataType, HasMany, BelongsToMany } from 'sequelize-typescript';
import { UserRole } from './userRole';

@Table({
  timestamps: false,
  tableName: 'Role',
})
export class Role extends Model {
  @Column({
    type: DataType.INTEGER,
    primaryKey: true,
  })
  id!: number;

  @Column({
    type: DataType.STRING,
  })
  name!: string;

  @Column({
    type: DataType.STRING,
  })
  description!: string;

  @Column({
    type: DataType.INTEGER,
    defaultValue: 2500,
  })
  quotaLimit!: number;

  @HasMany(() => UserRole)
  UserRoles!: UserRole[];
}
