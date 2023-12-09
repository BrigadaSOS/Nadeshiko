import { Table, Model, Column, DataType, HasMany, ForeignKey, BelongsTo, HasOne } from "sequelize-typescript";
import { ApiAuth } from "../api/apiAuth";
import { ApiUsageHistory } from "../api/apiUsageHistory";
import { DataTypes } from "sequelize";
import { UserRole } from './userRole'
import { UserAuth } from './userAuth'

@Table({
  timestamps: false,
  tableName: "User",
})
export class User extends Model {
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: number;

  // Basic data from user
  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  username!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  email!: string;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  })
  created_at!: Date;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  modified_at!: Date;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  last_login!: Date;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false
  })
  is_verified!: Boolean;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false
  })
  is_active!: Boolean;

  // Fields for local auth
  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  password!: string;

  @HasOne(() => ApiAuth)
  apiAuth!: ApiAuth;

  @HasMany(() => ApiUsageHistory)
  apiUsageHistories!: ApiUsageHistory[];

  @HasMany(() => UserRole)
  UserRoles!: UserRole[];

  @HasMany(() => UserAuth)
  userAuths!: UserAuth[];

}
