import { Table, Model, Column, DataType, BelongsTo, ForeignKey } from 'sequelize-typescript';
import { User } from '../user/user';
import { ApiAuth } from './apiAuth';
@Table({
  timestamps: false,
  tableName: 'ApiUsageHistory',
  indexes: [
    {
      fields: ['apiAuthId', 'used_at'],
    },
    {
      fields: ['user_id'],
    },
  ],
})
export class ApiUsageHistory extends Model {
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: number;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  used_at!: Date;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  user_id!: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  request!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  method!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  endpoint!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  ipAddress!: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  responseStatus!: number;

  @BelongsTo(() => User)
  user!: User;

  @BelongsTo(() => ApiAuth)
  apiAuth!: ApiAuth;

  @ForeignKey(() => ApiAuth)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  apiAuthId!: number;
}
