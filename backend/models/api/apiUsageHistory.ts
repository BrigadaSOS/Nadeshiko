import { Table, Model, Column, DataType, HasMany, BelongsTo, ForeignKey } from "sequelize-typescript";
import { User } from "../user/user"
@Table({
  timestamps: false,
  tableName: "ApiUsageHistory",
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

  @BelongsTo(() => User)
  user!: User;

}
