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
} from "sequelize-typescript";
import { ApiPermission } from "./apiPermission";
import { User } from "../user/user";
import { ApiUsageHistory } from "./apiUsageHistory";
import { ApiAuthPermission } from "./ApiAuthPermission";

@Table({
  timestamps: false,
  tableName: "ApiAuth",
})
export class ApiAuth extends Model {
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    primaryKey: true,
    autoIncrement: true,
  })
  id!: number;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  name!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  hint!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  token!: string;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  createdAt!: Date;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
  })
  isActive!: boolean;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  userId!: number;

  @BelongsToMany(() => ApiPermission, () => ApiAuthPermission)
  permissions!: ApiPermission[];

  @BelongsTo(() => User)
  user!: User;

}
