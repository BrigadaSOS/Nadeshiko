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
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW
  })
  created_at!: Date;

  @Column({
    type: DataType.DATE,
    allowNull: true
  })
  updated_at!: Date;
  
  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  romaji_name!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
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

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  airing_format!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  airing_status!: string;

  @Column({
    type: DataType.ARRAY(DataType.STRING),
    allowNull: true,
  })
  genres!: Array<string>;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  cover!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  banner!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  version!: string;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: true
  })
  is_visible!: boolean;

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