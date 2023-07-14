import { Table, Model, Column, DataType, HasMany, ForeignKey, BelongsTo, HasOne } from "sequelize-typescript";
import { ApiAuth } from "../api/apiAuth";
import { ApiUsageHistory } from "../api/apiUsageHistory";
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


  @HasOne(() => ApiAuth)
  apiAuth!: ApiAuth;

  @HasMany(() => ApiUsageHistory)
  apiUsageHistories!: ApiUsageHistory[];

}
