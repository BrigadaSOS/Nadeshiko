import { Table, Model, Column, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { DataTypes } from 'sequelize';
import { User } from './user';

@Table({
  timestamps: true,
  tableName: 'UserToken',
})
export class UserToken extends Model {
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
  token!: string;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  })
  created_at!: Date;

  @Column({
    type: DataType.ENUM,
    values: ['PASSWORD_RESET', 'ACCOUNT_VERIFICATION'],
    allowNull: false,
  })
  type!: string;

  @BelongsTo(() => User)
  user!: User;
}
