import { Table, Model, Column, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { User } from './user';
import { Role } from './role';

@Table({
  timestamps: false,
  tableName: 'UserRole',
})
export class UserRole extends Model {
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: number;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
  })
  id_user!: number;

  @BelongsTo(() => User)
  user!: User;

  @ForeignKey(() => Role)
  @Column({
    type: DataType.INTEGER,
  })
  id_role!: number;

  @BelongsTo(() => Role)
  role!: Role;
}
