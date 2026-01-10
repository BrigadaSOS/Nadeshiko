import { Table, Model, Column, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { User } from './user';

@Table({
  timestamps: false,
  tableName: 'UserAuth',
})
export class UserAuth extends Model {
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
    allowNull: false,
  })
  userId!: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  provider!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  providerUserId!: string;

  @BelongsTo(() => User)
  user!: User;
}
