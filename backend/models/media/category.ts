import { Table, Model, Column, DataType, HasMany } from "sequelize-typescript";
import { Media } from "./media";

@Table({
  timestamps: false,
  tableName: "Category",
})
export class Category extends Model {
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    primaryKey: true,
    autoIncrement: true
  })
  id!: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  name!: string;

  @HasMany(() => Media)
  media!: Media[];
}
