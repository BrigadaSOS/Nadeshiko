import { Table, Model, Column, DataType, HasMany, ForeignKey, BelongsTo } from "sequelize-typescript";
import { Category } from "./category";
import { Season } from "./season"

@Table({
  timestamps: false,
  tableName: "Media",
})
export class Media extends Model {
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    primaryKey: true,
    autoIncrement: true
  })
  id!: number

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  english_name!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  japanese_name!: string;
  
  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  folder_media_name!: string;

  @ForeignKey(() => Category)
  @Column({
    type: DataType.INTEGER,
    allowNull: false
  })
  id_category!: number

  @BelongsTo(() => Category)
  category!: Category;
  
  @HasMany(() => Season)
  season!: Season[];

}